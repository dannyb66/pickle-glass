const { GoogleGenerativeAI } = require("@google/generative-ai")
const { GoogleGenAI } = require("@google/genai")


// Retain every source packet and conversation turn for both response paths.
function convertMessages(messages) {
  const instructions = []
  const contents = []
  for (const message of messages) {
    if (message.role === "system") {
      instructions.push(message.content)
      continue
    }
    const parts = (Array.isArray(message.content) ? message.content : [message.content]).flatMap(part => {
      if (typeof part === "string") return [{ text: part }]
      if (part?.type === "text") return [{ text: part.text }]
      if (part?.type === "image_url") {
        const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(part.image_url?.url || "")
        if (!match) throw new Error("Gemini requires an inline image with a valid MIME type.")
        return [{ inlineData: { mimeType: match[1], data: match[2] } }]
      }
      return []
    })
    if (!parts.length) continue
    const role = message.role === "assistant" ? "model" : "user"
    const previous = contents[contents.length - 1]
    if (previous?.role === role) previous.parts.push({ text: "\n\n" }, ...parts)
    else contents.push({ role, parts })
  }
  if (!contents.length) throw new Error("A message is required for Gemini.")
  return { systemInstruction: instructions.join("\n\n"), contents }
}

class GeminiProvider {
    static async validateApiKey(key) {
        if (!key || typeof key !== 'string') {
            return { success: false, error: 'Invalid Gemini API key format.' };
        }

        try {
            const validationUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
            const response = await fetch(validationUrl);

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData.error?.message || `Validation failed with status: ${response.status}`;
                return { success: false, error: message };
            }
        } catch (error) {
            console.error(`[GeminiProvider] Network error during key validation:`, error);
            return { success: false, error: 'A network error occurred during validation.' };
        }
    }
}


/**
 * Creates a Gemini STT session
 * @param {object} opts - Configuration options
 * @param {string} opts.apiKey - Gemini API key
 * @param {string} [opts.language='en-US'] - Language code
 * @param {object} [opts.callbacks] - Event callbacks
 * @returns {Promise<object>} STT session
 */
async function createSTT({ apiKey, language = "en-US", callbacks = {}, ...config }) {
  const liveClient = new GoogleGenAI({ vertexai: false, apiKey })

  // Language code BCP-47 conversion
  const lang = language.includes("-") ? language : `${language}-US`

  const session = await liveClient.live.connect({

    model: 'gemini-live-2.5-flash-preview',
    callbacks: {
      ...callbacks,
      onMessage: (msg) => {
        if (!msg || typeof msg !== 'object') return;
        msg.provider = 'gemini';
        callbacks.onmessage?.(msg);
      }
    },

    config: {
      inputAudioTranscription: {},
      speechConfig: { languageCode: lang },
    },
  })

  return {
    sendRealtimeInput: async (payload) => session.sendRealtimeInput(payload),
    close: async () => session.close(),
  }
}

/**
 * Creates a Gemini LLM instance with proper text response handling
 */
function createLLM({ apiKey, model = "gemini-2.5-flash", temperature = 0.7, maxTokens = 8192, ...config }) {
  const client = new GoogleGenerativeAI(apiKey)

  return {
    generateContent: async (parts) => {
      const geminiModel = client.getGenerativeModel({
        model: model,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          // Ensure we get text responses, not JSON
          responseMimeType: "text/plain",
        },
      })

      const systemPrompt = ""
      const userContent = []

      for (const part of parts) {
        if (typeof part === "string") {
          // Don't automatically assume strings starting with "You are" are system prompts
          // Check if it's explicitly marked as a system instruction
          userContent.push(part)
        } else if (part.inlineData) {
          userContent.push({
            inlineData: {
              mimeType: part.inlineData.mimeType,
              data: part.inlineData.data,
            },
          })
        }
      }

      try {
        const result = await geminiModel.generateContent(userContent)
        const response = await result.response

        // Return plain text, not wrapped in JSON structure
        return {
          response: {
            text: () => response.text(),
          },
        }
      } catch (error) {
        console.error("Gemini API error:", error)
        throw error
      }
    },

    chat: async (messages) => {
      const { systemInstruction, contents } = convertMessages(messages)

      const geminiModel = client.getGenerativeModel({
        model: model,
        systemInstruction:
          systemInstruction ||
          "Respond naturally in plain text format. Do not use JSON or structured responses unless specifically requested.",
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxTokens,
          // Force plain text responses
          responseMimeType: "text/plain",
        },
      })

      const result = await geminiModel.generateContent({ contents })
      const response = await result.response

      // Return plain text content
      return {
        content: response.text(),
        raw: result,
      }
    },
  }
}

/**
 * Creates a Gemini streaming LLM instance with text response fix
 */
function createStreamingLLM({ apiKey, model = "gemini-2.5-flash", temperature = 0.7, maxTokens = 8192, ...config }) {
  const client = new GoogleGenerativeAI(apiKey)

  return {
    streamChat: async (messages) => {
      console.log("[Gemini Provider] Starting streaming request")

      const { systemInstruction, contents } = convertMessages(messages)

      const geminiModel = client.getGenerativeModel({
        model: model,
        systemInstruction:
          systemInstruction ||
          "Respond naturally in plain text format. Do not use JSON or structured responses unless specifically requested.",
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens || 8192,
          // Force plain text responses
          responseMimeType: "text/plain",
        },
      })

      const stream = new ReadableStream({
        async start(controller) {
          try {
            const result = await geminiModel.generateContentStream({ contents })

            for await (const chunk of result.stream) {
              const chunkText = chunk.text() || ""

              // Format as SSE data - this should now be plain text
              const data = JSON.stringify({
                choices: [
                  {
                    delta: {
                      content: chunkText,
                    },
                  },
                ],
              })
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
            }

            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
            controller.close()
          } catch (error) {
            console.error("[Gemini Provider] Streaming error:", error)
            controller.error(error)
          }
        },
      })

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    },
  }
}

module.exports = {
    GeminiProvider,
    createSTT,
    createLLM,
    createStreamingLLM
};
