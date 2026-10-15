const OpenAI = require('openai');
const WebSocket = require('ws');
const { Portkey } = require('portkey-ai');
const { Readable } = require('stream');
const { getProviderForModel } = require('../factory.js');


class OpenAIProvider {
    static async validateApiKey(key) {
        if (!key || typeof key !== 'string' || !key.startsWith('sk-')) {
            return { success: false, error: 'Invalid OpenAI API key format.' };
        }

        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData.error?.message || `Validation failed with status: ${response.status}`;
                return { success: false, error: message };
            }
        } catch (error) {
            console.error(`[OpenAIProvider] Network error during key validation:`, error);
            return { success: false, error: 'A network error occurred during validation.' };
        }
    }
}


/**
 * Creates an OpenAI STT session
 * @param {object} opts - Configuration options
 * @param {string} opts.apiKey - OpenAI API key
 * @param {string} [opts.language='en'] - Language code
 * @param {object} [opts.callbacks] - Event callbacks
 * @param {boolean} [opts.usePortkey=false] - Whether to use Portkey
 * @param {string} [opts.portkeyVirtualKey] - Portkey virtual key
 * @returns {Promise<object>} STT session
 */
async function createSTT({ apiKey, language = 'en', model = 'gpt-4o-mini-transcribe', callbacks = {}, usePortkey = false, portkeyVirtualKey, ...config }) {
  const key = usePortkey ? (portkeyVirtualKey || apiKey) : apiKey;
  const wsUrl = usePortkey
    ? 'wss://api.portkey.ai/v1/realtime?intent=transcription'
    : 'wss://api.openai.com/v1/realtime?intent=transcription';
  const headers = usePortkey
    ? { 'x-portkey-api-key': 'gRv2UGRMq6GGLJ8aVEB4e7adIewu', 'x-portkey-virtual-key': key }
    : { Authorization: `Bearer ${key}` };
  const ws = new WebSocket(wsUrl, { headers });

  return new Promise((resolve, reject) => {
    let ready = false;
    let settled = false;
    const fail = error => {
      if (!settled) {
        settled = true;
        clearTimeout(initializationTimeout);
        reject(error);
        ws.close();
      }
    };
    const initializationTimeout = setTimeout(() => {
      fail(new Error('OpenAI transcription session configuration timed out.'));
    }, 20000);
    initializationTimeout.unref?.();
    const session = {
      sendRealtimeInput(audioData) {
        if (!ready || ws.readyState !== WebSocket.OPEN) {
          throw new Error('OpenAI transcription session is not ready.');
        }
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioData }));
      },
      keepAlive() {
        if (ready && ws.readyState === WebSocket.OPEN) ws.ping();
      },
      close() {
        ready = false;
        clearTimeout(initializationTimeout);
        ws.close(1000, 'Client initiated close.');
      },
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: { input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model, prompt: config.prompt || '', language: language || 'en' },
            turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 200, silence_duration_ms: 100 },
            noise_reduction: { type: 'near_field' },
          } },
        },
      }));
    };
    ws.onmessage = event => {
      if (!event.data || event.data === 'null' || event.data === '[DONE]') return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      message.provider = 'openai';
      if (message.type === 'error') {
        fail(new Error(message.error?.message || 'OpenAI transcription configuration rejected.'));
      } else if (message.type === 'session.updated' && message.session?.type === 'transcription' && !settled) {
        ready = true;
        settled = true;
        clearTimeout(initializationTimeout);
        resolve(session);
      }
      callbacks.onmessage?.(message);
    };
    ws.onerror = error => {
      fail(new Error(error.message || 'OpenAI transcription connection failed.'));
      callbacks.onerror?.(error);
    };
    ws.onclose = event => {
      ready = false;
      fail(new Error('OpenAI transcription session closed before configuration was accepted.'));
      callbacks.onclose?.(event);
    };
  });
}

/**
 * Creates an OpenAI LLM instance
 * @param {object} opts - Configuration options
 * @param {string} opts.apiKey - OpenAI API key
 * @param {string} [opts.model='gpt-4.1'] - Model name
 * @param {number} [opts.temperature=0.7] - Temperature
 * @param {number} [opts.maxTokens=2048] - Max tokens
 * @param {boolean} [opts.usePortkey=false] - Whether to use Portkey
 * @param {string} [opts.portkeyVirtualKey] - Portkey virtual key
 * @returns {object} LLM instance
 */
function createLLM({ apiKey, model = 'gpt-4.1', temperature = 0.7, maxTokens = 2048, usePortkey = false, portkeyVirtualKey, ...config }) {
  const client = new OpenAI({ apiKey });
  
  const callApi = async (messages) => {
    if (!usePortkey) {
      const response = await client.chat.completions.create({
        model: model,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens
      });
      return {
        content: response.choices[0].message.content.trim(),
        raw: response
      };
    } else {
      const fetchUrl = 'https://api.portkey.ai/v1/chat/completions';
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
            'x-portkey-api-key': 'gRv2UGRMq6GGLJ8aVEB4e7adIewu',
            'x-portkey-virtual-key': portkeyVirtualKey || apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: model,
            messages,
            temperature,
            max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`Portkey API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return {
        content: result.choices[0].message.content.trim(),
        raw: result
      };
    }
  };

  return {
    generateContent: async (parts) => {
      const messages = [];
      let systemPrompt = '';
      let userContent = [];
      
      for (const part of parts) {
        if (typeof part === 'string') {
          if (systemPrompt === '' && part.includes('You are')) {
            systemPrompt = part;
          } else {
            userContent.push({ type: 'text', text: part });
          }
        } else if (part.inlineData) {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
          });
        }
      }
      
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      if (userContent.length > 0) messages.push({ role: 'user', content: userContent });
      
      const result = await callApi(messages);

      return {
        response: {
          text: () => result.content
        },
        raw: result.raw
      };
    },
    
    // For compatibility with chat-style interfaces
    chat: async (messages) => {
      return await callApi(messages);
    }
  };
}

/** 
 * Creates an OpenAI streaming LLM instance
 * @param {object} opts - Configuration options
 * @param {string} opts.apiKey - OpenAI API key
 * @param {string} [opts.model='gpt-4.1'] - Model name
 * @param {number} [opts.temperature=0.7] - Temperature
 * @param {number} [opts.maxTokens=2048] - Max tokens
 * @param {boolean} [opts.usePortkey=false] - Whether to use Portkey
 * @param {string} [opts.portkeyVirtualKey] - Portkey virtual key
 * @returns {object} Streaming LLM instance
 */
function createStreamingLLM({ apiKey, model = 'gpt-4.1', temperature = 0.7, maxTokens = 2048, usePortkey = false, portkeyVirtualKey, ...config }) {
  return {
    streamChat: async (messages) => {
      const fetchUrl = usePortkey 
        ? 'https://api.portkey.ai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      
      const headers = usePortkey
        ? {
            'x-portkey-api-key': 'gRv2UGRMq6GGLJ8aVEB4e7adIewu',
            'x-portkey-virtual-key': portkeyVirtualKey || apiKey,
            'Content-Type': 'application/json',
          }
        : {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          };

      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      return response;
    }
  };
}

module.exports = {
    OpenAIProvider,
    createSTT,
    createLLM,
    createStreamingLLM
}; 