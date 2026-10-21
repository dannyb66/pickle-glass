const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
function load(relative, mocks) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
        module, exports: module.exports, process, console: { log() {}, warn() {}, error() {} },
        require(name) { if (!(name in mocks)) throw Error(`Unexpected ${name}`); return mocks[name]; },
    });
    return module.exports;
}
function harness() {
    const bridge = new EventEmitter(), events = [], calls = [];
    const controls = { owner: 'a', sessionRequests: 0, sttStarts: 0, messages: [{ role: 'user', content: 'Question without audio' }], captures: 0 };
    const auth = { getCurrentUserId: () => controls.owner, getCurrentUser: () => ({ uid: controls.owner }) };
    const sessions = { getOrCreateActive: async () => { controls.sessionRequests++; return 'chat-session'; }, getById: async id => controls.lookup ? controls.lookup(id) : ({ id, uid: 'a' }) };
    const windows = { windowPool: new Map([['header', { isDestroyed: () => false, webContents: { send: (channel, data) => events.push([channel, data]) } }]]) };
    const Summary = load('features/listen/summary/summaryService.js', {
        '../../common/prompts/promptBuilder.js': { getSystemPrompt: () => 'Base instructions' },
        '../../common/ai/factory': { createLLM: () => ({ chat: async messages => { calls.push(messages); if (controls.chat) return controls.chat(messages); return { content: '**Summary Overview**\n- Chat insight' }; } }) },
        '../../common/repositories/session': sessions, './repositories': { saveSummary: async () => {} },
        '../../common/services/modelStateService': { getCurrentModelInfo: async () => ({ provider: 'synthetic', apiKey: 'test', model: 'test' }) },
        '../../common/services/interviewContextService': { on() {}, context: () => ({}), snapshot() {} },
        '../../common/services/authService': auth, '../../../window/windowManager': windows,
        '../stt/repositories': { getAllTranscriptsBySessionId: async () => [] },
        '../../ask/repositories': { getAllAiMessagesBySessionId: async () => controls.messages },
        '../../common/services/insightsScreenContext': { get: () => [], capture: async () => { controls.captures++; return {}; }, clear() {} },
    });
    const listen = load('features/listen/listenService.js', {
        electron: {}, './summary/summaryService': Summary,
        './stt/sttService': class { setCallbacks() {} initializeSttSessions() { controls.sttStarts++; } },
        '../common/services/authService': auth, '../common/repositories/session': sessions, './stt/repositories': {},
        '../../bridge/internalBridge': bridge, '../../window/windowManager': windows,
    });
    return { listen, controls, bridge, events, calls };
}

test('fresh Insights refresh ensures the chat session and analyzes without starting audio; repeated refresh stays visible', async () => {
    const h = harness();
    for (let i = 0; i < 2; i++) assert.equal((await h.listen.analyzeInsights('entire', { show: true })).success, true);
    assert.equal(h.listen.insightsVisible, true);
    assert.equal(h.controls.sessionRequests, 1);
    assert.equal(h.controls.sttStarts, 0);
    assert.equal(h.listen.currentSessionId, null, 'Insights never claims an active capture session');
    assert.equal(h.listen.summaryService.getState().isRecording, false);
    assert.equal(h.controls.captures, 2);
    assert.equal(h.calls.length, 2);
    assert.match(h.calls[0][1].content, /Question without audio/);
});

test('real chat events attach the context and auto-analyze completed answers with audio off', async () => {
    const h = harness();
    h.bridge.emit('ask:messageSaved', { sessionId: 'chat-session', owner: 'a', role: 'user' });
    assert.equal(h.listen.summaryService.currentSessionId, 'chat-session');
    assert.equal(h.calls.length, 0);
    h.controls.messages.push({ role: 'assistant', content: 'Draft answer' });
    h.bridge.emit('ask:messageSaved', { sessionId: 'chat-session', owner: 'a', role: 'assistant' });
    await h.listen.summaryService.queue;
    assert.equal(h.calls.length, 1);
    assert.equal(h.controls.captures, 0, 'automatic refresh uses chat screenshots without taking new ones');
    assert.equal(h.controls.sttStarts, 0);
    assert.equal(h.listen.summaryService.getState().sources.chat, 2);
    h.bridge.emit('ask:messageSaved', { sessionId: 'private-other-account', owner: 'b', role: 'assistant' });
    assert.equal(h.listen.summaryService.currentSessionId, 'chat-session');
});

test('chat events cannot replace a different actively recording session', () => {
    const h = harness(); h.listen.currentSessionId = 'audio-session';
    h.listen.summaryService.setSessionId('audio-session');
    h.bridge.emit('ask:messageSaved', { sessionId: 'old-review', owner: 'a', role: 'assistant' });
    assert.equal(h.listen.summaryService.currentSessionId, 'audio-session');
    assert.equal(h.calls.length, 0);
});


test('pending session selection cannot restore context after explicit Start or a newer chat context', async t => {
    for (const change of ['clear', 'new-chat']) await t.test(change, async () => {
        const h = harness(); h.listen.summaryService.setSessionId('old-context', { isRecording: false });
        let finish; h.controls.lookup = () => new Promise(resolve => { finish = resolve; });
        const pending = h.listen.analyzeInsights('entire', { show: true });
        if (change === 'clear') h.listen.clearReviewedSession();
        else h.bridge.emit('ask:messageSaved', { sessionId: 'new-context', owner: 'a', role: 'user' });
        finish({ id: 'old-context', uid: 'a' });
        assert.equal((await pending).success, false);
        assert.equal(h.listen.summaryService.currentSessionId, change === 'clear' ? null : 'new-context');
        assert.equal(h.calls.length, 0); assert.equal(h.controls.captures, 0);
        assert.equal(h.listen.summaryService.getState().phase, 'idle', 'stale lookup errors cannot overwrite the new context');
    });
});

test('concurrent fresh refreshes share session selection and the latest queued request wins', async () => {
    const h = harness();
    const first = h.listen.analyzeInsights('entire', { show: true });
    const second = h.listen.analyzeInsights('entire', { show: true });
    assert.equal((await first).success, true); assert.equal((await second).success, true);
    assert.equal(h.controls.sessionRequests, 1);
    assert.equal(h.calls.length, 1);
    assert.equal(h.listen.summaryService.getState().phase, 'updated');
});

test('joining Listen to the same chat session preserves an in-flight analysis and settles its busy state', async () => {
    const h = harness(); h.bridge.emit('ask:messageSaved', { sessionId: 'chat-session', owner: 'a', role: 'user' });
    let finish; h.controls.chat = () => new Promise(resolve => { finish = resolve; });
    const pending = h.listen.analyzeInsights('entire');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.listen.summaryService.getState().phase, 'analyzing');
    assert.equal(await h.listen.initializeNewSession(), true);
    finish({ content: '**Summary Overview**\n- Completed while audio joined' });
    assert.equal((await pending).success, true);
    assert.equal(h.listen.summaryService.getState().phase, 'updated');
    assert.equal(h.listen.summaryService.getState().isRecording, true);
});
