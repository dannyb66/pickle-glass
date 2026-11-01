const { app, BrowserWindow } = require('electron');
const { createStreamingLLM } = require('../common/ai/factory');
// Lazy require helper to avoid circular dependency issues
const getWindowManager = () => require('../../window/windowManager');
const internalBridge = require('../../bridge/internalBridge');

const getWindowPool = () => {
    try {
        return getWindowManager().windowPool;
    } catch {
        return null;
    }
};

const sessionRepository = require('../common/repositories/session');
const askRepository = require('./repositories');
const feedRepository = require('../common/repositories/feed');
const { getSystemPrompt } = require('../common/prompts/promptBuilder');
const path = require('node:path');
const fs = require('node:fs');
const os = require('os');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);
const { desktopCapturer, screen, nativeImage } = require('electron');
const { randomUUID } = require('node:crypto');
const modelStateService = require('../common/services/modelStateService');
const interviewContext = require('../common/services/interviewContextService');

// Try to load sharp, but don't fail if it's not available
let sharp;
try {
    sharp = require('sharp');
    console.log('[AskService] Sharp module loaded successfully');
} catch (error) {
    console.warn('[AskService] Sharp module not available:', error.message);
    console.warn('[AskService] Screenshot functionality will work with reduced image processing capabilities');
    sharp = null;
}
let lastScreenshot = null;

async function captureScreenshot(options = {}) {
    let tempPath;
    try {
        let buffer;
        if (process.platform === 'darwin') {
            tempPath = path.join(os.tmpdir(), `glass-${randomUUID()}.jpg`);
            const args = ['-x', '-t', 'jpg'];
            if (options.display) {
                if (!screen.getAllDisplays().some(d => d.id === options.display.id))
                    throw new Error('The selected display is no longer available.');
                const { x, y, width, height } = options.display.bounds;
                args.push(`-R${x},${y},${width},${height}`);
            }
            await execFile('screencapture', [...args, tempPath]);
            buffer = await fs.promises.readFile(tempPath);
        } else {
            const sources = await desktopCapturer.getSources({
                types: ['screen'], thumbnailSize: { width: 2048, height: 2048 },
            });
            const source = options.display
                ? sources.find(s => String(s.display_id) === String(options.display.id)) : sources[0];
            if (!source || source.thumbnail.isEmpty?.()) throw new Error('No screen capture available. Check screen recording permissions.');
            buffer = source.thumbnail.toJPEG(80);
        }
        let width, height, thumbnail;
        if (sharp) {
            const image = sharp(buffer);
            const size = options.explicit ? { width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true } : { height: 384 };
            buffer = await image.resize(size).jpeg({ quality: 80 }).toBuffer();
            const resized = await sharp(buffer).metadata();
            width = resized.width; height = resized.height;
            thumbnail = (await sharp(buffer).resize({ width: 180, height: 110, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
        } else if (options.explicit) {
            let image = nativeImage.createFromBuffer(buffer);
            const original = image.getSize();
            if (!original.width || !original.height) throw new Error('Empty screenshot. Check screen recording permissions.');
            const ratio = Math.min(1, 2048 / Math.max(original.width, original.height));
            image = image.resize({ width: Math.round(original.width * ratio), height: Math.round(original.height * ratio) });
            ({ width, height } = image.getSize());
            buffer = image.toJPEG(80);
            thumbnail = image.resize({ width: 180 }).toJPEG(70).toString('base64');
        }
        const base64 = buffer.toString('base64');
        lastScreenshot = { base64, width, height, timestamp: Date.now() };
        return { success: true, base64, width, height, thumbnail, bytes: base64.length };
    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
    }
}

/**
 * @class
 * @description
 */
class AskService {
    constructor() {
        this.feedImports = new Map();
        this.activeEntry = null;
        this.attachments = new Map();
        this.captureEpoch = 0;
        this.captureQueue = Promise.resolve();
        this.requestActive = false;
        this.abortController = null;
        this.requestSessionId = null;
        this.reviewSession = null;
        internalBridge.on?.('listen:sessionStarted', () => this.clearReviewContext());
        interviewContext.on('invalidated', sessions => {
            if (sessions.includes(this.requestSessionId)) this.abortController?.abort('Interview context deleted');
            if (sessions.includes(this.reviewSession?.id)) this.clearReviewContext();
        });
        this.state = {
            isVisible: false,
            isLoading: false,
            isStreaming: false,
            currentQuestion: '',
            currentResponse: '',
            showTextInput: true,
            attachments: [], submittedAttachments: [], capturePending: 0, attachmentError: '',
        };
        console.log('[AskService] Service instance created.');
    }

    async getFeed(before = null, selectedSessionId = null) {
        const owner = require('../common/services/authService').getCurrentUserId();
        const sessionId = selectedSessionId || this.reviewSession?.id || await sessionRepository.getOrCreateActive('ask');
        const session = await sessionRepository.getById(sessionId);
        if (!session || session.uid !== owner || owner !== require('../common/services/authService').getCurrentUserId()) throw new Error('This history is unavailable for the current account.');
        if (!this.feedImports.has(sessionId)) {
            const migration = (async () => {
                const page = await feedRepository.list(sessionId, 'ask');
                if (!page.entries.length) {
                    const legacy = await askRepository.getAllAiMessagesBySessionId(sessionId);
                    let entry;
                    for (let index = 0; index < legacy.length; index++) {
                        const message = legacy[index];
                        if (message.role === 'user') {
                            if (entry) await feedRepository.save(sessionId, 'ask', entry);
                            const timestamp = message.sent_at?.toMillis ? message.sent_at.toMillis() : Number(message.sent_at) * 1000;
                            entry = { id: `${sessionId}-legacy-${message.id || index}`, timestamp: timestamp || Date.now(), question: message.content, answer: '', status: 'complete', attachments: [] };
                        } else {
                            if (!entry) entry = { id: `${sessionId}-legacy-${message.id || index}`, timestamp: message.sent_at?.toMillis ? message.sent_at.toMillis() : Number(message.sent_at) * 1000 || Date.now(), question: '', answer: '', status: 'complete', attachments: [] };
                            entry.answer += message.content || '';
                        }
                    }
                    if (entry) await feedRepository.save(sessionId, 'ask', entry);
                }
            })();
            this.feedImports.set(sessionId, migration);
            migration.catch(() => this.feedImports.delete(sessionId));
        }
        await this.feedImports.get(sessionId);
        const page = await feedRepository.list(sessionId, 'ask', before);
        if (owner !== require('../common/services/authService').getCurrentUserId()) throw new Error('Account changed while loading history.');
        return { ...page, sessionId, entries: page.entries.map(entry => entry.status === 'streaming' && entry.id !== this.activeEntry?.id ? { ...entry, status: 'interrupted' } : entry) };
    }

    resetForOwnerChange() {
        this.captureEpoch++;
        this.abortController?.abort('Account changed');
        this.attachments.clear();
        this.feedImports.clear();
        this.activeEntry = null;
        this.state = { ...this.state, currentQuestion: '', currentResponse: '', submittedAttachments: [],
            feedEntry: null, feedSessionId: null, capturePending: 0, attachmentError: '', isLoading: false, isStreaming: false };
        this.clearReviewContext();
    }

    getAttachmentState() {
        return { attachments: [...this.attachments.values()].map(({ id, thumbnail, width, height, timestamp }) =>
            ({ id, thumbnail: `data:image/jpeg;base64,${thumbnail}`, width, height, timestamp })),
            capturePending: this.state.capturePending, attachmentError: this.state.attachmentError };
    }

    removeAttachment(id) {
        this.attachments.delete(id);
        this.state.attachmentError = '';
        this._broadcastState();
        return this.getAttachmentState();
    }

    clearDraftAttachments() {
        if (this.state.capturePending) return { success: false };
        this.attachments.clear();
        this.state.attachmentError = '';
        this._broadcastState();
        return { success: true };
    }

    captureAttachment() {
        // Resolve the pointer now, not after earlier captures have completed.
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const epoch = this.captureEpoch;
        const owner = require('../common/services/authService').getCurrentUserId();
        const current = () => epoch === this.captureEpoch && owner === require('../common/services/authService').getCurrentUserId();
        this.state.capturePending++;
        this.state.attachmentError = '';
        this._broadcastState();
        const task = async () => {
            try {
                if (!current()) return { success: false, error: 'Account changed.' };
                if (this.attachments.size >= 5) throw new Error('Maximum five screenshots per question. Remove one to capture another.');
                const image = await captureScreenshot({ display, explicit: true });
                if (!current()) return { success: false, error: 'Account changed.' };
                if (!image.success) throw new Error(image.error);
                if ([...this.attachments.values()].reduce((n, a) => n + a.bytes, 0) + image.bytes > 20 * 1024 * 1024)
                    throw new Error('Screenshot attachments exceed 20 MB. Remove an image and try again.');
                const id = randomUUID();
                this.attachments.set(id, { ...image, id, timestamp: Date.now() });
                return { success: true };
            } catch (error) {
                if (current()) this.state.attachmentError = error.message;
                return { success: false, error: error.message };
            } finally {
                if (current()) {
                this.state.capturePending--;
                this.state.showTextInput = true;
                this.state.isVisible = true;
                internalBridge.emit('window:requestVisibility', { name: 'ask', visible: true });
                this._broadcastState();
                const win = getWindowPool()?.get('ask');
                if (win && !win.isDestroyed()) {
                    win.focus?.();
                    win.webContents.send('ask:showTextInput');
                }
                }
            }
        };
        const result = this.captureQueue.then(task);
        this.captureQueue = result.catch(() => {});
        return result;
    }

    _broadcastState() {
        const askWindow = getWindowPool()?.get('ask');
        if (askWindow && !askWindow.isDestroyed()) {
            askWindow.webContents.send('ask:stateUpdate', { ...this.state, ...this.getAttachmentState(),
                feedEntry: this.activeEntry ? { ...this.activeEntry, answer: this.state.currentResponse } : this.state.feedEntry });
        }
    }

    async toggleAskButton(inputScreenOnly = false) {
        const askWindow = getWindowPool()?.get('ask');
        if (!askWindow || askWindow.isDestroyed()) return;
        // Returning from another app focuses the composer. A second Cmd+Enter
        // submits its actual draft through the renderer, never an empty replacement.
        const submit = inputScreenOnly && askWindow.isVisible() && !!askWindow.isFocused?.();
        internalBridge.emit('window:requestVisibility', { name: 'ask', visible: true });
        this.state.isVisible = true;
        this.state.showTextInput = true;
        if (process.platform === 'darwin') app.focus({ steal: true });
        askWindow.focus();
        askWindow.webContents.focus();
        this._broadcastState();
        askWindow.webContents.send('ask:showTextInput', { submit });
    }

    clearReviewContext() {
        if (this.reviewSession?.id === this.requestSessionId) this.abortController?.abort('Reviewed session changed');
        this.reviewSession = null;
    }

    async sendMessageForSession(userPrompt, sessionId) {
        const owner = require('../common/services/authService').getCurrentUserId();
        const session = await sessionRepository.getById(sessionId);
        if (!session || session.uid !== owner || owner !== require('../common/services/authService').getCurrentUserId()) throw new Error('This reviewed session is unavailable for the current account.');
        interviewContext.snapshot(sessionId);
        this.reviewSession = { id: sessionId, owner };
        return this.sendMessage(userPrompt);
    }

    async closeAskWindow () {
            this.clearReviewContext();
            if (this.abortController) {
                this.abortController.abort('Window closed by user');
                this.abortController = null;
            }
    
            this.state = {
                ...this.state,
                isVisible      : false,
                isLoading      : false,
                isStreaming    : false,
                currentQuestion: this.state.currentQuestion,
                currentResponse: this.state.currentResponse,
                submittedAttachments: [],
                showTextInput  : true,
            };
            this._broadcastState();
    
            internalBridge.emit('window:requestVisibility', { name: 'ask', visible: false });
    
            return { success: true };
        }
    

    /**
     * 
     * @param {string[]} conversationTexts
     * @returns {string}
     * @private
     */
    _formatConversationForPrompt(conversationTexts) {
        if (!conversationTexts || conversationTexts.length === 0) {
            return 'No conversation history available.';
        }
        return conversationTexts.slice(-30).join('\n');
    }

    /**
     * 
     * @param {string} userPrompt
     * @returns {Promise<{success: boolean, response?: string, error?: string}>}
     */
    async sendMessage(userPrompt, conversationHistoryRaw = null) {
        const requestOwner = require('../common/services/authService').getCurrentUserId();
        if (this.requestActive || this.state.capturePending) return { success: false, error: 'Wait for the current request or screenshot capture to finish.' };
        let attachmentIds = [];
        if (userPrompt && typeof userPrompt === 'object') {
            attachmentIds = userPrompt.attachmentIds;
            userPrompt = userPrompt.text;
            if (!Array.isArray(attachmentIds) || new Set(attachmentIds).size !== attachmentIds.length ||
                attachmentIds.some(id => typeof id !== 'string' || !this.attachments.has(id)))
                return { success: false, error: 'Invalid or expired screenshot attachment.' };
        }
        if (typeof userPrompt !== 'string') return { success: false, error: 'Question must be text.' };
        const selectedImages = attachmentIds.map(id => this.attachments.get(id));
        this.requestActive = true;
        internalBridge.emit('window:requestVisibility', { name: 'ask', visible: true });
        this.state = {
            ...this.state,
            isLoading: true,
            isStreaming: false,
            currentQuestion: userPrompt,
            submittedAttachments: this.getAttachmentState().attachments.filter(a => attachmentIds.includes(a.id)),
            currentResponse: '',
            contextLabel: '',
            showTextInput: true,
        };
        this._broadcastState();

        if (this.abortController) {
            this.abortController.abort('New request received.');
        }
        this.abortController = new AbortController();
        const { signal } = this.abortController;


        let sessionId;
        let completed = false;
        let requestError = '';
        try {
            console.log(`[AskService] 🤖 Processing message: ${userPrompt.substring(0, 50)}...`);

            const review = this.reviewSession;
            if (review) {
                const session = await sessionRepository.getById(review.id);
                if (review !== this.reviewSession || !session || session.uid !== review.owner || review.owner !== require('../common/services/authService').getCurrentUserId()) throw new Error('Reviewed session changed. Reopen it before asking.');
                sessionId = review.id;
            } else {
                sessionId = await sessionRepository.getOrCreateActive('ask');
            }
            if (signal.aborted) throw new Error('Request cancelled.');
            this.requestSessionId = sessionId;
            const interview = interviewContext.context(sessionId);
            this.state.contextLabel = interview.profile ? `Interview: ${interview.profile.name} · v${interview.profile.revision}` : 'Generic mode';
            const feed = await this.getFeed(null, sessionId);
            if (signal.aborted || requestOwner !== require('../common/services/authService').getCurrentUserId()) throw new Error('Request context changed. Ask again.');
            this.state.feedSessionId = sessionId;
            const askWin = getWindowPool()?.get('ask');
            askWin?.webContents.send('ask:feedPage', { ...feed, reset: true });
            this.activeEntry = { id: randomUUID(), timestamp: Date.now(), question: userPrompt, answer: '',
                attachments: this.state.submittedAttachments, status: 'streaming' };
            await feedRepository.save(sessionId, 'ask', this.activeEntry);
            if (signal.aborted || requestOwner !== require('../common/services/authService').getCurrentUserId()) throw new Error('Request context changed. Ask again.');
            this._broadcastState();
            // Normal Ask requests include captured audio from this active session.
            // An explicit array (including [] for screen-only Ask) remains authoritative.
            if (!Array.isArray(conversationHistoryRaw)) {
                const sttRepository = require('../listen/stt/repositories');
                const transcripts = await sttRepository.getAllTranscriptsBySessionId(sessionId);
                conversationHistoryRaw = transcripts
                    .filter(turn => typeof turn.text === 'string' && turn.text.trim())
                    .map(turn => `${turn.speaker || 'speaker'}: ${turn.text.trim()}`);
            }
            if (signal.aborted || requestOwner !== require('../common/services/authService').getCurrentUserId()) throw new Error('Request context changed. Ask again.');
            await askRepository.addAiMessage({ sessionId, role: 'user', content: userPrompt.trim() });
            if (signal.aborted || requestOwner !== require('../common/services/authService').getCurrentUserId()) throw new Error('Request context changed. Ask again.');
            internalBridge.emit('ask:messageSaved', { sessionId, owner: requestOwner, role: 'user' });
            console.log(`[AskService] DB: Saved user prompt to session ${sessionId}`);
            
            const modelInfo = await modelStateService.getCurrentModelInfo('llm');
            if (!modelInfo || !modelInfo.apiKey) {
                throw new Error('AI model or API key not configured.');
            }
            console.log(`[AskService] Using model: ${modelInfo.model} for provider: ${modelInfo.provider}`);

            const screenshotResult = selectedImages.length ? { success: false } : await captureScreenshot({ quality: 'medium' });
            if (signal.aborted || requestOwner !== require('../common/services/authService').getCurrentUserId()) throw new Error('Request context changed. Ask again.');
            const screenshotBase64 = screenshotResult.success ? screenshotResult.base64 : null;
            for (const image of selectedImages.length ? selectedImages : (screenshotBase64 ? [screenshotResult] : [])) {
                require('../common/services/insightsScreenContext').remember(sessionId, requestOwner, image);
            }

            const conversationHistory = this._formatConversationForPrompt(conversationHistoryRaw);

            const systemPrompt = getSystemPrompt('pickle_glass_analysis', interview.context ? '' : conversationHistory, false) + (interview.policy ? `\n\n${interview.policy}` : '');

            const messages = [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: `User Request: ${userPrompt.trim()}` },
                    ],
                },
            ];

            const currentMessage = messages[1];
            if (interview.context) messages.splice(1, 0, interview.context, { role: 'user', content: `Recent conversation (observations):\n${conversationHistory}` });
            for (const image of selectedImages.length ? selectedImages : (screenshotBase64 ? [{ base64: screenshotBase64 }] : [])) {
                currentMessage.content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.base64}` } });
            }
            
            const streamingLLM = createStreamingLLM(modelInfo.provider, {
                apiKey: modelInfo.apiKey,
                model: modelInfo.model,
                temperature: 0.7,
                maxTokens: 2048,
                usePortkey: modelInfo.provider === 'openai-glass',
                portkeyVirtualKey: modelInfo.provider === 'openai-glass' ? modelInfo.apiKey : undefined,
            });

            try {
                interviewContext.snapshot(sessionId);
                if (signal.aborted) throw new Error('Request cancelled.');
                const response = await streamingLLM.streamChat(messages);
                const askWin = getWindowPool()?.get('ask');

                if (!askWin || askWin.isDestroyed()) {
                    console.error("[AskService] Ask window is not available to send stream to.");
                    response.body.getReader().cancel();
                    return { success: false, error: 'Ask window is not available.' };
                }

                const reader = response.body.getReader();
                if (signal.aborted) { await reader.cancel(); throw new Error('Request cancelled.'); }
                signal.addEventListener('abort', () => {
                    console.log(`[AskService] Aborting stream reader. Reason: ${signal.reason}`);
                    reader.cancel(signal.reason).catch(() => { /* 이미 취소된 경우의 오류는 무시 */ });
                });

                await this._processStream(reader, askWin, sessionId, signal, requestOwner);
                if (signal.aborted) throw new Error('Request cancelled. Your draft was retained.');
                attachmentIds.forEach(id => this.attachments.delete(id));
                this._broadcastState();
                completed = true;
                return { success: true };

            } catch (multimodalError) {
                // 멀티모달 요청이 실패했고 스크린샷이 포함되어 있다면 텍스트만으로 재시도
                if (!selectedImages.length && screenshotBase64 && this._isMultimodalError(multimodalError)) {
                    console.log(`[AskService] Multimodal request failed, retrying with text-only: ${multimodalError.message}`);
                    
                    // 텍스트만으로 메시지 재구성
                    const textOnlyMessages = messages.map(message => message === currentMessage ? { role: 'user', content: `User Request: ${userPrompt.trim()}` } : message);
                    interviewContext.snapshot(sessionId);
                    if (signal.aborted) throw new Error('Request cancelled.');

                    const fallbackResponse = await streamingLLM.streamChat(textOnlyMessages);
                    const askWin = getWindowPool()?.get('ask');

                    if (!askWin || askWin.isDestroyed()) {
                        console.error("[AskService] Ask window is not available for fallback response.");
                        fallbackResponse.body.getReader().cancel();
                        return { success: false, error: 'Ask window is not available.' };
                    }

                    const fallbackReader = fallbackResponse.body.getReader();
                    if (signal.aborted) { await fallbackReader.cancel(); throw new Error('Request cancelled.'); }
                    signal.addEventListener('abort', () => {
                        console.log(`[AskService] Aborting fallback stream reader. Reason: ${signal.reason}`);
                        fallbackReader.cancel(signal.reason).catch(() => {});
                    });

                    await this._processStream(fallbackReader, askWin, sessionId, signal, requestOwner);
                    if (signal.aborted) throw new Error('Request cancelled. Your draft was retained.');
                    completed = true;
                    return { success: true };
                } else {
                    // 다른 종류의 에러이거나 스크린샷이 없었다면 그대로 throw
                    throw multimodalError;
                }
            }

        } catch (error) {
            requestError = error.message || 'Request failed';
            // A superseded request must not reset the newer question or its stream.
            if (signal.aborted || requestOwner !== require('../common/services/authService').getCurrentUserId()) return { success: false, error: 'Request cancelled.' };
            console.error('[AskService] Error during message processing:', error);
            this.state = {
                ...this.state,
                isLoading: false,
                isStreaming: false,
                showTextInput: true,
            };
            this._broadcastState();

            const askWin = getWindowPool()?.get('ask');
            if (askWin && !askWin.isDestroyed()) {
                const streamError = error.message || 'Unknown error occurred';
                askWin.webContents.send('ask-response-stream-error', { error: streamError });
            }

            return { success: false, error: error.message };
        } finally {
            if (this.activeEntry) {
                this.state.feedEntry = { ...this.activeEntry, answer: this.state.currentResponse,
                    status: completed ? 'complete' : (signal.aborted ? 'cancelled' : 'failed'),
                    error: completed ? '' : requestError || 'Request cancelled' };
                this.activeEntry = null;
                if (requestOwner === require('../common/services/authService').getCurrentUserId()) {
                    this.state.isLoading = false;
                    this.state.isStreaming = false;
                    this.state.showTextInput = true;
                    try { await feedRepository.save(sessionId, 'ask', this.state.feedEntry); }
                    catch (error) { this.state.attachmentError = `Answer history could not be saved: ${error.message}`; }
                    this._broadcastState();
                }
            }
            if (this.abortController?.signal === signal) this.abortController = null;
            this.requestActive = false;
        }
    }

    /**
     * 
     * @param {ReadableStreamDefaultReader} reader
     * @param {BrowserWindow} askWin
     * @param {number} sessionId 
     * @param {AbortSignal} signal
     * @returns {Promise<void>}
     * @private
     */
    async _processStream(reader, askWin, sessionId, signal, requestOwner) {
        const decoder = new TextDecoder();
        let fullResponse = '';

        try {
            this.state.isLoading = false;
            this.state.isStreaming = true;
            this._broadcastState();
            let pendingLine = '';
            const processLine = line => {
                if (!line.startsWith('data:')) return false;
                const data = line.slice(5).trim();
                if (data === '[DONE]') return true;
                try {
                    const json = JSON.parse(data);
                    const token = json.choices?.[0]?.delta?.content || '';
                    if (token) {
                        if (signal.aborted) return;
                        fullResponse += token;
                        this.state.currentResponse = fullResponse;
                        this._broadcastState();
                    }
                } catch {
                    // Ignore non-content events; incomplete lines remain buffered below.
                }
                return false;
            };
            while (true) {
                const { done, value } = await reader.read();
                pendingLine += done ? decoder.decode() : decoder.decode(value, { stream: true });
                let newline;
                while ((newline = pendingLine.indexOf('\n')) !== -1) {
                    const line = pendingLine.slice(0, newline).replace(/\r$/, '');
                    pendingLine = pendingLine.slice(newline + 1);
                    if (processLine(line)) return;
                }
                if (done) {
                    if (pendingLine.trim()) processLine(pendingLine);
                    break;
                }
            }
        } catch (streamError) {
            if (signal.aborted) {
                console.log(`[AskService] Stream reading was intentionally cancelled. Reason: ${signal.reason}`);
            } else {
                console.error('[AskService] Error while processing stream:', streamError);
                throw streamError;
            }
        } finally {
            if (!signal.aborted) {
                this.state.isStreaming = false;
                this.state.currentResponse = fullResponse;
                this._broadcastState();
            }
            if (fullResponse && !signal.aborted && requestOwner === require('../common/services/authService').getCurrentUserId()) {
                 try {
                    interviewContext.snapshot(sessionId);
                    await askRepository.addAiMessage({ sessionId, role: 'assistant', content: fullResponse });
                    if (!signal.aborted && requestOwner === require('../common/services/authService').getCurrentUserId()) internalBridge.emit('ask:messageSaved', { sessionId, owner: requestOwner, role: 'assistant' });
                    console.log(`[AskService] DB: Saved partial or full assistant response to session ${sessionId} after stream ended.`);
                } catch(dbError) {
                    console.error("[AskService] DB: Failed to save assistant response after stream ended:", dbError);
                }
            }
        }
    }

    /**
     * 멀티모달 관련 에러인지 판단
     * @private
     */
    _isMultimodalError(error) {
        const errorMessage = error.message?.toLowerCase() || '';
        return (
            errorMessage.includes('vision') ||
            errorMessage.includes('image') ||
            errorMessage.includes('multimodal') ||
            errorMessage.includes('unsupported') ||
            errorMessage.includes('image_url') ||
            errorMessage.includes('400') ||  // Bad Request often for unsupported features
            errorMessage.includes('invalid') ||
            errorMessage.includes('not supported')
        );
    }

}

const askService = new AskService();

module.exports = askService;
