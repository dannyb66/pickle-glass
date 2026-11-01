const summaryDependencies = require('./summary-test-dependencies.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = relative => fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8');
function load(relative, mocks, extras = {}) {
    const module = { exports: {} }; vm.runInNewContext(source(relative), { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval, process, ...extras,
        require(name) { if (name in summaryDependencies) return summaryDependencies[name]; if (name in mocks) return mocks[name]; return require(name); } }); return module.exports;
}
const later = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('Summary pins owner/session/generation before awaits and drops a switched request before sending', async () => {
    const pending = later(); const calls = []; let owner = 'owner-a';
    const Summary = load('features/listen/summary/summaryService.js', {
        '../../common/services/insightsScreenContext': { capture: async () => ({}), get: () => [], clear() {} },
        electron: {}, '../../../window/windowManager': { windowPool: new Map() }, '../../common/prompts/promptBuilder.js': { getSystemPrompt: () => 'generic' },
        '../../common/ai/factory': { createLLM: () => ({ chat: async messages => { calls.push(messages); return { content: 'response' }; } }) },
        '../../common/repositories/session': { touch: async () => {} }, './repositories': { saveSummary: () => assert.fail('old summary must not save') },
        '../../common/services/modelStateService': { getCurrentModelInfo: () => pending.promise },
        '../../common/services/authService': { getCurrentUserId: () => owner },
        '../../common/services/interviewContextService': { on() {}, context: id => ({ policy: 'trusted', context: { role: 'user', content: `PINNED ${id}` } }), snapshot() {} }
    });
    const summary = new Summary(); summary.setSessionId('A'); const request = summary.makeOutlineAndRequests(['Old A audio']);
    await new Promise(resolve => setImmediate(resolve)); summary.setSessionId('B'); owner = 'owner-b'; pending.resolve({ apiKey: 'synthetic', provider: 'test', model: 'test' });
    assert.equal(await request, null); assert.equal(calls.length, 0);
});
test('Summary uses the exact same pinned source packet as Ask and never puts source content in system policy', async () => {
    const calls = []; const packet = '{"profileId":"Orchid","interview_sources":["resume","jd","reference"]}';
    const Summary = load('features/listen/summary/summaryService.js', {
        '../../common/services/insightsScreenContext': { capture: async () => ({}), get: () => [], clear() {} },
        electron: {}, '../../../window/windowManager': { windowPool: new Map() }, '../../common/prompts/promptBuilder.js': { getSystemPrompt: () => 'generic {{CONVERSATION_HISTORY}}' },
        '../../common/ai/factory': { createLLM: () => ({ chat: async messages => { calls.push(messages); return { content: '**Summary Overview**\n- Orchid result' }; } }) },
        '../../common/repositories/session': { touch: async () => {} }, './repositories': { saveSummary() {} },
        '../../common/services/modelStateService': { getCurrentModelInfo: async () => ({ apiKey: 'synthetic', provider: 'test', model: 'test' }) },
        '../../common/services/authService': { getCurrentUserId: () => 'owner-a' },
        '../../common/services/interviewContextService': { on() {}, context: () => ({ policy: 'trusted', context: { role: 'user', content: packet } }), snapshot() {} }
    });
    const summary = new Summary(); summary.setSessionId('A'); await summary.makeOutlineAndRequests(['Orchid audio']);
    assert.equal(calls.length, 1); assert.equal(calls[0][1].content, packet); assert.doesNotMatch(calls[0][0].content, /Orchid/); assert.match(calls[0][2].content, /Orchid audio/);
});
test('closed STT callbacks cannot enter a new session and cancelled initialization closes orphan sockets', async () => {
    const callbacks = []; const transcripts = []; let closed = 0;
    const Stt = load('features/listen/stt/sttService.js', {
        electron: {}, child_process: { spawn() {} }, '../../common/services/modelStateService': { getCurrentModelInfo: async () => ({ provider: 'openai', model: 'test', apiKey: 'synthetic' }) },
        '../../common/ai/factory': { createSTT: async (_provider, options) => { callbacks.push(options.callbacks.onmessage); return { close: async () => { closed += 1; } }; } },
        '../../../window/windowManager': { windowPool: new Map() }
    });
    const stt = new Stt(); stt.setCallbacks({ onTranscriptionComplete: (speaker, text) => transcripts.push(text) });
    await stt.initializeSttSessions(); const old = callbacks[0]; await stt.closeSessions(); await stt.initializeSttSessions();
    old({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'PRIVATE OLD A AUDIO' }); stt.flushMyCompletion(); assert.deepEqual(transcripts, []);
    callbacks[2]({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Current B audio' }); stt.flushMyCompletion(); assert.deepEqual(transcripts, ['Current B audio']); await stt.closeSessions(); assert.equal(closed, 4);
});
test('Listen drops old transcript after a session switch during persistence and never feeds new Summary', async () => {
    const pending = later(); const saved = []; const summaries = [];
    const service = load('features/listen/listenService.js', {
        electron: {}, './stt/sttService': class { setCallbacks() {} }, './summary/summaryService': class { setCallbacks() {} addConversationTurn(speaker, text) { summaries.push(text); } },
        '../common/services/authService': { getCurrentUserId: () => 'owner' }, '../common/repositories/session': { touch: () => pending.promise },
        './stt/repositories': { addTranscript: entry => saved.push(entry) }, '../../bridge/internalBridge': new (require('node:events').EventEmitter)()
    });
    service.currentSessionId = 'A'; const request = service.handleTranscriptionComplete('Me', 'Old A private audio'); service.currentSessionId = 'B'; service.sessionGeneration += 1; pending.resolve(); await request;
    assert.deepEqual(saved, []); assert.deepEqual(summaries, []);
});
test('signed-in bound interview repositories stay local; foreign-owner routing rejects rather than falls through', async () => {
    for (const relative of ['features/ask/repositories/index.js','features/listen/stt/repositories/index.js','features/listen/summary/repositories/index.js']) {
        const calls = []; let foreign = false;
        const filename = path.join(__dirname, '../src', relative); const authRel = relative.includes('/ask/') ? '../../common/services/authService' : '../../../common/services/authService';
        const contextRel = authRel.replace('authService','interviewContextService');
        const methods = { addAiMessage: value => calls.push(['local', value]), addTranscript: value => calls.push(['local', value]), saveSummary: value => calls.push(['local', value]) };
        const adapter = load(relative, { './sqlite.repository': methods, './firebase.repository': new Proxy({}, { get: () => () => assert.fail('must not use Firebase') }),
            [authRel]: { getCurrentUser: () => ({ isLoggedIn: true }), getCurrentUserId: () => 'owner' }, [contextRel]: { isLocalSession: () => { if (foreign) throw new Error('different user'); return true; } } });
        const method = relative.includes('/ask/') ? 'addAiMessage' : relative.includes('/stt/') ? 'addTranscript' : 'saveSummary';
        await adapter[method]({ sessionId: 'local-interview', content: 'private', text: 'private' }); assert.equal(calls.length, 1); foreign = true; assert.throws(() => adapter[method]({ sessionId: 'local-interview' }), /different user/);
    }
});

test('STT cancellation while provider sockets open closes both orphans and cannot revive capture', async () => {
    const left = later(); const right = later(); let created = 0; let closed = 0;
    const Stt = load('features/listen/stt/sttService.js', {
        electron: {}, child_process: {}, '../../common/services/modelStateService': { getCurrentModelInfo: async () => ({ provider: 'openai', apiKey: 'synthetic' }) },
        '../../common/ai/factory': { createSTT: () => (++created === 1 ? left.promise : right.promise) }
    });
    const stt = new Stt(); const initialization = stt.initializeSttSessions();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(created, 2); await stt.closeSessions();
    left.resolve({ close: async () => { closed++; } }); right.resolve({ close: async () => { closed++; } });
    await assert.rejects(initialization, /cancelled/); assert.equal(closed, 2); assert.equal(stt.isSessionActive(), false); assert.equal(stt.keepAliveInterval, null); assert.equal(stt.sessionRenewTimeout, null);
});
test('STT partial provider failure closes the successful socket without claiming a live session', async () => {
    let created = 0; let closed = 0;
    const Stt = load('features/listen/stt/sttService.js', {
        electron: {}, child_process: {}, '../../common/services/modelStateService': { getCurrentModelInfo: async () => ({ provider: 'openai', apiKey: 'synthetic' }) },
        '../../common/ai/factory': { createSTT: async () => { if (++created === 2) throw new Error('provider failed'); return { close: async () => { closed++; } }; } }
    });
    const stt = new Stt(); await assert.rejects(stt.initializeSttSessions(), /failed/); assert.equal(closed, 1); assert.equal(stt.isSessionActive(), false); assert.equal(stt.keepAliveInterval, null);
});

test('JD redirect to a private address is rejected before a second HTTP request', async () => {
    const { EventEmitter } = require('node:events'); let requests = 0; const lookupNames = [];
    const sources = load('features/common/services/interviewSourceService.js', {
        '../prompts/interviewContext': require('../src/features/common/prompts/interviewContext'),
        'node:dns/promises': { lookup: async hostname => { lookupNames.push(hostname); return [{ address: hostname === 'public.example' ? '8.8.8.8' : '127.0.0.1', family: 4 }]; } },
        'node:https': { get(url, options, callback) { requests++; const request = new EventEmitter(); request.destroy = error => { request.emit('error', error); request.emit('close'); }; process.nextTick(() => { const response = new EventEmitter(); response.statusCode = 302; response.headers = { location: 'https://private.example/internal' }; response.destroy = () => {}; callback(response); response.emit('end'); request.emit('close'); }); return request; } }
    }, { TextDecoder });
    await assert.rejects(sources.fetchJobDescription('https://public.example/job'), /public internet/);
    assert.equal(requests, 1); assert.deepEqual(lookupNames, ['public.example', 'private.example']);
});
test('JD deadline includes unresolved DNS and cannot be extended by a trickling response', async () => {
    const { EventEmitter } = require('node:events'); const realContext = require('../src/features/common/prompts/interviewContext');
    const dnsWait = load('features/common/services/interviewSourceService.js', { '../prompts/interviewContext': realContext }, { TextDecoder });
    await assert.rejects(dnsWait.fetchJobDescription('https://public.example/job', { lookup: () => new Promise(() => {}), deadline: Date.now() + 15 }), /timed out/);
    let ticks = 0;
    const trickle = load('features/common/services/interviewSourceService.js', { '../prompts/interviewContext': realContext,
        'node:https': { get(url, options, callback) { const request = new EventEmitter(); let interval; request.destroy = error => { clearInterval(interval); request.emit('error', error); request.emit('close'); }; process.nextTick(() => { const response = new EventEmitter(); response.statusCode = 200; response.headers = { 'content-type': 'text/html' }; callback(response); interval = setInterval(() => { ticks++; response.emit('data', Buffer.from('still streaming')); }, 3); }); return request; } }
    }, { TextDecoder });
    await assert.rejects(trickle.fetchJobDescription('https://public.example/job', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], deadline: Date.now() + 20 }), /timed out/); assert.ok(ticks > 0);
});
