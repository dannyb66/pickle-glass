const { BrowserWindow } = require('electron');
const SttService = require('./stt/sttService');
const SummaryService = require('./summary/summaryService');
const authService = require('../common/services/authService');
const sessionRepository = require('../common/repositories/session');
const sttRepository = require('./stt/repositories');
const internalBridge = require('../../bridge/internalBridge');

class ListenService {
    constructor() {
        this.sttService = new SttService();
        this.summaryService = new SummaryService();
        this.currentSessionId = null;
        this.isInitializingSession = false;
        this.sessionGeneration = 0;
        this.pendingTranscriptWrites = new Set();
        this.transcriptSaveErrors = new Map();
        this.isStoppingSession = false;
        this.insightsVisible = false;

        internalBridge.on('ask:messageSaved', event => this.handleChatMessageSaved(event));
        this.setupServiceCallbacks();
        console.log('[ListenService] Service instance created.');
    }

    setupServiceCallbacks() {
        // STT service callbacks
        this.sttService.setCallbacks({
            onTranscriptionComplete: (speaker, text) => {
                return this.handleTranscriptionComplete(speaker, text);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            }
        });

        // Summary service callbacks
        this.summaryService.setCallbacks({
            onAnalysisComplete: (data) => {
                console.log('📊 Analysis completed:', data);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            }
        });
    }

    sendToRenderer(channel, data) {
        const { windowPool } = require('../../window/windowManager');
        const listenWindow = windowPool?.get('listen');
        
        if (listenWindow && !listenWindow.isDestroyed()) {
            listenWindow.webContents.send(channel, data);
        }
    }

    initialize() {
        this.setupIpcHandlers();
        console.log('[ListenService] Initialized and ready.');
    }

    async handleListenRequest(listenButtonText) {
        const { windowPool } = require('../../window/windowManager');
        const listenWindow = windowPool.get('listen');
        const header = windowPool.get('header');

        try {
            switch (listenButtonText) {
                case 'Listen':
                    console.log('[ListenService] changeSession to "Listen"');
                    this.setInsightsVisibility(true);
                    if (!await this.initializeSession()) throw new Error('Listen initialization failed.');
                    if (listenWindow && !listenWindow.isDestroyed()) {
                        listenWindow.webContents.send('session-state-changed', { isActive: true });
                    }
                    break;
        
                case 'Stop':
                    console.log('[ListenService] changeSession to "Stop"');
                    {
                        const result = await this.closeSession({ preserveReview: true });
                        if (result?.success === false) throw Object.assign(new Error(result.error || 'Session stopped, but could not be saved completely.'), { sessionStatus: 'afterSession' });
                    }
                    if (listenWindow && !listenWindow.isDestroyed()) {
                        listenWindow.webContents.send('session-state-changed', { isActive: false });
                    }
                    break;
        
                case 'Done':
                    console.log('[ListenService] changeSession to "Done"');
                    this.setInsightsVisibility(false);
                    listenWindow.webContents.send('session-state-changed', { isActive: false });
                    break;
        
                default:
                    throw new Error(`[ListenService] unknown listenButtonText: ${listenButtonText}`);
            }
            
            header.webContents.send('listen:changeSessionResult', { success: true, status: { Listen: 'inSession', Stop: 'afterSession', Done: 'beforeSession' }[listenButtonText] });

        } catch (error) {
            console.error('[ListenService] error in handleListenRequest:', error);
            header.webContents.send('listen:changeSessionResult', { success: false, error: error.message, ...(error.sessionStatus ? { status: error.sessionStatus } : {}) });
            throw error; 
        }
    }

    handleTranscriptionComplete(speaker, text) {
        const write = this.persistTranscriptionComplete(speaker, text);
        this.pendingTranscriptWrites.add(write);
        write.finally(() => this.pendingTranscriptWrites.delete(write));
        return write;
    }

    async persistTranscriptionComplete(speaker, text) {
        const sessionId = this.currentSessionId;
        const generation = this.sessionGeneration;
        const owner = authService.getCurrentUserId();
        const current = () => sessionId && this.currentSessionId === sessionId && authService.getCurrentUserId() === owner
            && (this.sessionGeneration === generation || (this.closingSession?.id === sessionId && this.closingSession.generation === generation && this.closingSession.owner === owner));
        if (!current() || !text.trim()) return;
        try {
            await sessionRepository.touch(sessionId);
            if (!current()) return;
            await sttRepository.addTranscript({ sessionId, speaker, text: text.trim() });
            if (!current()) return;
            this.summaryService.addConversationTurn(speaker, text);
        } catch (error) {
            this.transcriptSaveErrors.set(sessionId, error.message);
            this.summaryService.broadcastState?.({ phase: 'error', error: `Transcript could not be saved: ${error.message}` });
            console.error('[ListenService] Could not save current transcript:', error.message);
        }
    }

    async saveConversationTurn(speaker, transcription) {
        // Compatibility entry point shares the same guarded persistence path.
        return this.handleTranscriptionComplete(speaker, transcription);
    }

    async initializeNewSession(generation = this.sessionGeneration) {
        try {
            // The UID is no longer passed to the repository method directly.
            // The adapter layer handles UID injection. We just ensure a user is available.
            const user = authService.getCurrentUser();
            if (!user) {
                // This case should ideally not happen as authService initializes a default user.
                throw new Error("Cannot initialize session: auth service not ready.");
            }
            
            const sessionId = await sessionRepository.getOrCreateActive('listen');
            if (generation !== this.sessionGeneration) return false;
            this.currentSessionId = sessionId;
            internalBridge.emit('listen:sessionStarted', { sessionId });
            console.log(`[DB] New listen session ensured: ${this.currentSessionId}`);

            // Set session ID for summary service
            const sameContext = this.summaryService.currentSessionId === sessionId && this.summaryService.sessionOwner === user.uid;
            if (sameContext) this.summaryService.setRecording(true);
            else {
                this.summaryService.setSessionId(this.currentSessionId);
                this.summaryService.resetConversationHistory();
            }

            console.log('New conversation session started:', this.currentSessionId);
            return true;
        } catch (error) {
            console.error('Failed to initialize new session in DB:', error);
            this.currentSessionId = null;
            return false;
        }
    }

    async initializeSession(language = 'en') {
        if (this.isInitializingSession || this.isStoppingSession) {
            console.log('Session initialization already in progress.');
            return false;
        }

        const generation = ++this.sessionGeneration;
        this.isInitializingSession = true;
        this.sendToRenderer('session-initializing', true);
        this.sendToRenderer('update-status', 'Initializing sessions...');

        try {
            // Initialize database session
            const sessionInitialized = await this.initializeNewSession(generation);
            if (!sessionInitialized) {
                throw new Error('Failed to initialize database session');
            }

            /* ---------- STT Initialization Retry Logic ---------- */
            const MAX_RETRY = 10;
            const RETRY_DELAY_MS = 300;   // 0.3 seconds

            let sttReady = false;
            for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
                if (generation !== this.sessionGeneration) throw new Error('Session start cancelled.');
                try {
                    await this.sttService.initializeSttSessions(language);
                    sttReady = true;
                    break;                         // Exit on success
                } catch (err) {
                    console.warn(
                        `[ListenService] STT init attempt ${attempt} failed: ${err.message}`
                    );
                    if (attempt < MAX_RETRY) {
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                    }
                }
            }
            if (!sttReady) throw new Error('STT init failed after retries');
            /* ------------------------------------------- */

            if (generation !== this.sessionGeneration) throw new Error('Session start cancelled.');
            console.log('✅ Listen service initialized successfully.');
            
            this.sendToRenderer('update-status', 'Connected. Ready to listen.');
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize listen service:', error);
            this.sendToRenderer('update-status', 'Initialization failed.');
            return false;
        } finally {
            this.isInitializingSession = false;
            this.sendToRenderer('session-initializing', false);
            if (generation === this.sessionGeneration && this.sttService.isSessionActive()) this.sendToRenderer('change-listen-capture-state', { status: "start" });
        }
    }

    async sendMicAudioContent(data, mimeType) {
        return await this.sttService.sendMicAudioContent(data, mimeType);
    }

    async startMacOSAudioCapture() {
        if (process.platform !== 'darwin') {
            throw new Error('macOS audio capture only available on macOS');
        }
        return await this.sttService.startMacOSAudioCapture();
    }

    async stopMacOSAudioCapture() {
        this.sttService.stopMacOSAudioCapture();
    }

    isSessionActive() {
        return this.sttService.isSessionActive();
    }

    handleChatMessageSaved({ sessionId, owner, role }) {
        if (!sessionId || owner !== authService.getCurrentUserId() || (this.currentSessionId && this.currentSessionId !== sessionId)) return;
        if (this.summaryService.currentSessionId !== sessionId || this.summaryService.sessionOwner !== owner) {
            this.summaryService.setSessionId(sessionId, { isRecording: this.currentSessionId === sessionId });
            this.summaryService.resetConversationHistory();
        }
        this.summaryService.onChatMessageSaved(role);
    }

    async ensureInsightsSession() {
        const owner = authService.getCurrentUserId();
        const generation = this.sessionGeneration;
        const contextGeneration = this.summaryService.generation;
        const pending = this.insightsSessionPending;
        if (pending && pending.owner === owner && pending.generation === generation && pending.contextGeneration === contextGeneration) return pending.promise;
        const promise = (async () => {
            const sessionId = this.currentSessionId || (this.summaryService.sessionOwner === owner && this.summaryService.currentSessionId)
                || await sessionRepository.getOrCreateActive('ask');
            const session = await sessionRepository.getById(sessionId);
            if (owner !== authService.getCurrentUserId() || generation !== this.sessionGeneration || contextGeneration !== this.summaryService.generation) throw new Error('Session changed. Analyze again.');
            if (!session || session.uid !== owner) throw new Error('This session is unavailable for the current account.');
            if (this.summaryService.currentSessionId !== sessionId || this.summaryService.sessionOwner !== owner) {
                this.summaryService.setSessionId(sessionId, { isRecording: this.currentSessionId === sessionId });
                this.summaryService.resetConversationHistory();
            }
            return sessionId;
        })();
        this.insightsSessionPending = { owner, generation, contextGeneration, promise };
        try { return await promise; }
        finally { if (this.insightsSessionPending?.promise === promise) this.insightsSessionPending = null; }
    }

    async analyzeInsights(scope = 'entire', { show = false } = {}) {
        if (show) this.setInsightsVisibility(true);
        const owner = authService.getCurrentUserId(), generation = this.summaryService.generation;
        try {
            await this.ensureInsightsSession();
            await this.summaryService.requestAnalysis(scope);
            return { success: true };
        } catch (error) {
            if (owner === authService.getCurrentUserId() && generation === this.summaryService.generation) this.summaryService.broadcastState({ phase: 'error', error: error.message, progress: '' });
            return { success: false, error: error.message };
        }
    }

    setInsightsVisibility(visible) {
        this.insightsVisible = !!visible;
        internalBridge.emit('window:requestVisibility', { name: 'listen', visible: this.insightsVisible });
        const header = require('../../window/windowManager').windowPool?.get('header');
        if (header && !header.isDestroyed()) header.webContents.send('listen:insightsVisibility', this.insightsVisible);
        return this.insightsVisible;
    }

    clearReviewedSession() {
        this.summaryService.clearSession?.();
        this.setInsightsVisibility(false);
        const header = require('../../window/windowManager').windowPool?.get('header');
        if (header && !header.isDestroyed()) header.webContents.send('listen:changeSessionResult', { success: true, status: 'beforeSession' });
    }

    async closeSession({ preserveReview = false } = {}) {
        if (this.stoppingPromise) return this.stoppingPromise;
        this.stoppingPromise = this.finishClosingSession(preserveReview);
        try { return await this.stoppingPromise; } finally { this.stoppingPromise = null; }
    }

    async finishClosingSession(preserveReview) {
        this.isStoppingSession = true;
        const closingSessionId = this.currentSessionId;
        const owner = authService.getCurrentUserId();
        this.closingSession = { id: closingSessionId, owner, generation: this.sessionGeneration };
        this.sessionGeneration++; // Cancel startup immediately; accepted writes retain their closing-session guard.
        // Cancel stale analyses while retaining the reviewed session on normal Stop.
        if (preserveReview) this.summaryService.onSessionStopped?.();
        else { this.summaryService.setSessionId(null); this.summaryService.resetConversationHistory(); }
        let closingError;
        try {
            this.sendToRenderer('change-listen-capture-state', { status: 'stop' });
            // Finalized speech may still be waiting in the STT debounce buffers.
            this.sttService.flushMyCompletion?.();
            this.sttService.flushTheirCompletion?.();
            let captureError;
            try { await this.sttService.closeSessions(); } catch (error) { captureError = error; }
            try { await this.stopMacOSAudioCapture(); } catch (error) { captureError ||= error; }
            while (this.pendingTranscriptWrites.size) await Promise.all([...this.pendingTranscriptWrites]);
            if (preserveReview) await this.summaryService.finish?.();
            this.sessionGeneration++;
            this.currentSessionId = null;
            if (owner !== authService.getCurrentUserId()) throw new Error('User changed while closing the session.');
            if (closingSessionId) await sessionRepository.end(closingSessionId);
            if (!preserveReview) this.summaryService.resetConversationHistory();
            const saveError = this.transcriptSaveErrors.get(closingSessionId);
            this.transcriptSaveErrors.delete(closingSessionId);
            if (saveError) throw new Error(`Session stopped, but some transcript text could not be saved: ${saveError}`);
            if (captureError) throw captureError;
            return { success: true };
        } catch (error) {
            closingError = error.message;
            this.sessionGeneration++;
            this.currentSessionId = null;
            this.summaryService.broadcastState?.({ phase: 'error', error: error.message, progress: '' });
            return { success: false, error: error.message };
        } finally {
            this.closingSession = null;
            this.isStoppingSession = false;
            if (owner === authService.getCurrentUserId()) {
                this.sendToRenderer('session-state-changed', { isActive: false });
                const header = require('../../window/windowManager').windowPool?.get('header');
                if (header && !header.isDestroyed()) header.webContents.send('listen:changeSessionResult', {
                    success: !closingError, status: preserveReview ? 'afterSession' : 'beforeSession',
                    ...(closingError ? { error: closingError } : {}),
                });
            }
        }
    }

    getCurrentSessionData() {
        return {
            sessionId: this.currentSessionId,
            conversationHistory: this.summaryService.getConversationHistory(),
            totalTexts: this.summaryService.getConversationHistory().length,
            analysisData: this.summaryService.getCurrentAnalysisData(),
        };
    }

    getConversationHistory() {
        return this.summaryService.getConversationHistory();
    }

    _createHandler(asyncFn, successMessage, errorMessage) {
        return async (...args) => {
            try {
                const result = await asyncFn.apply(this, args);
                if (successMessage) console.log(successMessage);
                // `startMacOSAudioCapture`는 성공 시 { success, error } 객체를 반환하지 않으므로,
                // 핸들러가 일관된 응답을 보내도록 여기서 success 객체를 반환합니다.
                // 다른 함수들은 이미 success 객체를 반환합니다.
                return result && typeof result.success !== 'undefined' ? result : { success: true };
            } catch (e) {
                console.error(errorMessage, e);
                return { success: false, error: e.message };
            }
        };
    }

    // `_createHandler`를 사용하여 핸들러들을 동적으로 생성합니다.
    handleSendMicAudioContent = this._createHandler(
        this.sendMicAudioContent,
        null,
        'Error sending user audio:'
    );

    handleStartMacosAudio = this._createHandler(
        async () => {
            if (process.platform !== 'darwin') {
                return { success: false, error: 'macOS audio capture only available on macOS' };
            }
            if (this.sttService.isMacOSAudioRunning?.()) {
                return { success: false, error: 'already_running' };
            }
            await this.startMacOSAudioCapture();
            return { success: true, error: null };
        },
        'macOS audio capture started.',
        'Error starting macOS audio capture:'
    );
    
    handleStopMacosAudio = this._createHandler(
        this.stopMacOSAudioCapture,
        'macOS audio capture stopped.',
        'Error stopping macOS audio capture:'
    );

    handleUpdateGoogleSearchSetting = this._createHandler(
        async (enabled) => {
            console.log('Google Search setting updated to:', enabled);
        },
        null,
        'Error updating Google Search setting:'
    );
}

const listenService = new ListenService();
module.exports = listenService;
