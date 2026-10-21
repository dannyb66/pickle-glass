const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relative, mocks) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
        module, exports: module.exports, Buffer, process, setTimeout, clearTimeout,
        setInterval, clearInterval, console: { log() {}, warn() {}, error() {} },
        require(name) { return name in mocks ? mocks[name] : require(name); },
    });
    return module.exports;
}
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function harness({ saveTranscript = async () => {}, touch = async () => {}, createSession = async () => 'session-a' } = {}) {
    const events = [];
    const Stt = load('features/listen/stt/sttService.js', {
        electron: {}, child_process: {}, '../../common/ai/factory': {},
        '../../common/services/modelStateService': {},
        '../../../window/windowManager': { windowPool: new Map() },
    });
    class Summary {
        constructor() { this.conversationHistory = []; this.analysisHistory = []; }
        setCallbacks() {}
        setSessionId(id) { this.currentSessionId = id; }
        resetConversationHistory() { this.conversationHistory = []; }
        addConversationTurn(speaker, text) { this.conversationHistory.push({ speaker, text }); }
        getConversationHistory() { return this.conversationHistory; }
        getCurrentAnalysisData() { return {}; }
    }
    const listen = load('features/listen/listenService.js', {
        electron: {}, './stt/sttService': Stt, './summary/summaryService': Summary,
        '../common/services/authService': { getCurrentUserId: () => 'owner', getCurrentUser: () => ({ uid: 'owner' }) },
        '../common/repositories/session': {
            getOrCreateActive: createSession,
            touch,
            end: async id => { events.push(['end', id]); },
        },
        './stt/repositories': {
            async addTranscript(entry) {
                await saveTranscript(entry);
                events.push(['saved', entry.speaker, entry.text]);
            },
        },
        '../../bridge/internalBridge': { emit() {} },
        '../../window/windowManager': { windowPool: new Map() },
    });
    listen.currentSessionId = 'session-a';
    listen.summaryService.setSessionId('session-a');
    listen.sttService.modelInfo = { provider: 'synthetic' };
    return { listen, events };
}

test('Stop persists both speakers buffered finalized turns before ending their session', async () => {
    const { listen, events } = harness();
    listen.sttService.myCompletionBuffer = 'Final answer from me.';
    listen.sttService.theirCompletionBuffer = 'Final question from them.';
    const result = await listen.closeSession();
    assert.equal(result.success, true);
    assert.deepEqual(events, [
        ['saved', 'Me', 'Final answer from me.'],
        ['saved', 'Them', 'Final question from them.'],
        ['end', 'session-a'],
    ]);
});

test('Stop waits for transcript writes already accepted before marking session complete', async () => {
    const pendingSave = deferred();
    const { listen, events } = harness({ saveTranscript: () => pendingSave.promise });
    listen.sttService.onTranscriptionComplete('Me', 'Accepted before Stop.');
    await new Promise(resolve => setImmediate(resolve));
    const stopping = listen.closeSession();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, [], 'session must stay incomplete while its transcript write is pending');
    pendingSave.resolve();
    await stopping;
    assert.deepEqual(events, [['saved', 'Me', 'Accepted before Stop.'], ['end', 'session-a']]);
});

test('Stop waits for an accepted turn stalled on the session touch operation', async () => {
    const pendingTouch = deferred();
    const { listen, events } = harness({ touch: () => pendingTouch.promise });
    listen.sttService.onTranscriptionComplete('Them', 'Question accepted before Stop.');
    const stopping = listen.closeSession();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, []);
    pendingTouch.resolve();
    await stopping;
    assert.deepEqual(events, [['saved', 'Them', 'Question accepted before Stop.'], ['end', 'session-a']]);
});

test('Stop reports failure when the final transcript cannot be saved', async () => {
    const { listen } = harness({ saveTranscript: async () => { throw new Error('Synthetic storage failure'); } });
    listen.sttService.myCompletionBuffer = 'This final answer failed to save.';
    const result = await listen.closeSession();
    assert.equal(result.success, false, 'a failed final save must not be presented as a complete session');
    assert.ok(result.error);
});

test('completed local session text survives closing and reopening its on-disk database', { skip: !process.versions.electron }, async () => {
    const os = require('node:os');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-session-persistence-'));
    const client = load('features/common/services/sqliteClient.js', {
        '../config/schema': require('../src/features/common/config/schema'),
    });
    const sessions = load('features/common/repositories/session/sqlite.repository.js', { '../../services/sqliteClient': client });
    const transcripts = load('features/listen/stt/repositories/sqlite.repository.js', { '../../../common/services/sqliteClient': client });
    const messages = load('features/ask/repositories/sqlite.repository.js', { '../../common/services/sqliteClient': client });
    const summaries = load('features/listen/summary/repositories/sqlite.repository.js', { '../../../common/services/sqliteClient': client });
    const databasePath = path.join(directory, 'synthetic.db');
    try {
        client.connect(databasePath);
        await client.initTables();
        const sessionId = sessions.create('synthetic-owner', 'listen');
        transcripts.addTranscript({ sessionId, speaker: 'Me', text: 'Durable synthetic conversation.' });
        messages.addAiMessage({ sessionId, role: 'user', content: 'Synthetic question?' });
        messages.addAiMessage({ sessionId, role: 'assistant', content: 'Synthetic answer.' });
        await summaries.saveSummary({ sessionId, tldr: 'First summary', text: 'First analysis', bullet_json: '[]', action_json: '[]' });
        await summaries.saveSummary({ sessionId, tldr: 'Latest summary', text: 'Latest analysis', bullet_json: '[]', action_json: '[]' });
        sessions.end(sessionId);
        client.close();
        client.connect(databasePath);
        await client.initTables();
        client.cleanupEmptySessions();
        assert.equal(sessions.getAllByUserId('synthetic-owner').length, 1);
        assert.ok(sessions.getById(sessionId).ended_at);
        assert.equal(transcripts.getAllTranscriptsBySessionId(sessionId)[0].text, 'Durable synthetic conversation.');
        assert.deepEqual(Array.from(messages.getAllAiMessagesBySessionId(sessionId), item => item.content), ['Synthetic question?', 'Synthetic answer.']);
        assert.equal(summaries.getSummaryBySessionId(sessionId).text, 'Latest analysis');
        assert.equal(client.getDb().prepare('SELECT COUNT(*) AS count FROM summaries WHERE session_id=?').get(sessionId).count, 1);
    } finally {
        client.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});


test('Stop cancels initialization before a delayed session lookup can revive capture', async () => {
    const sessionLookup = deferred(); const closingCapture = deferred();
    const { listen } = harness({ createSession: () => sessionLookup.promise });
    listen.currentSessionId = null;
    listen.sttService.closeSessions = () => closingCapture.promise;
    const initializing = listen.initializeNewSession(listen.sessionGeneration);
    const stopping = listen.closeSession();
    sessionLookup.resolve('late-session');
    assert.equal(await initializing, false, 'stopping must invalidate startup immediately, while still draining accepted transcript writes');
    closingCapture.resolve(); await stopping;
    assert.equal(listen.currentSessionId, null);
});
