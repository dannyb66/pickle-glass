const summaryDependencies = require('./summary-test-dependencies.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
const answer = name => ({ content: `**Summary Overview**\n- ${name}\n**Key Topic: Queue reliability**\n- Keep retries bounded\n**Suggested Questions**\n1. What is the load?` });
function harness(rows = Array.from({ length: 35 }, (_, i) => ({ speaker: 'Them', text: `fact-${i + 1}` }))) {
    const calls = [], saved = [], events = [];
    const controls = { owner: 'owner-a', rows, messages: [], images: [], captures: 0, capture: async () => ({ captured: true }), chat: async () => answer('A reviewed summary'), save: async value => saved.push(value), sessionOwner: 'owner-a' };
    const mocks = {
        '../../common/prompts/promptBuilder.js': { getSystemPrompt: () => 'Trusted instructions {{CONVERSATION_HISTORY}}' },
        '../../common/ai/factory': { createLLM: () => ({ chat: async messages => { calls.push(messages); return controls.chat(messages); } }) },
        '../../common/repositories/session': { getById: async id => ({ id, uid: controls.sessionOwner }) },
        './repositories': { saveSummary: value => controls.save(value) },
        '../../common/services/modelStateService': { getCurrentModelInfo: async () => ({ apiKey: 'synthetic', provider: 'synthetic', model: 'synthetic' }) },
        '../../common/services/authService': { getCurrentUserId: () => controls.owner },
        '../../common/services/interviewContextService': { on: (_name, fn) => { controls.invalidate = fn; }, context: () => ({ policy: 'Trusted interview policy', context: { role: 'user', content: 'PINNED RESUME JD REFERENCE' } }), snapshot() {} },
        '../../ask/repositories': { getAllAiMessagesBySessionId: async () => controls.messages },
        '../../common/services/insightsScreenContext': { get: () => controls.images, capture: async (...args) => { controls.captures++; return controls.capture(...args); }, clear() {} },
        '../stt/repositories': { getAllTranscriptsBySessionId: async () => controls.rows },
        '../../../window/windowManager': { windowPool: new Map([['listen', { isDestroyed: () => false, webContents: { send: (channel, data) => events.push({ channel, data }) } }]]) },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/listen/summary/summaryService.js'), 'utf8'), {
        module, exports: module.exports, console: { log() {}, error() {} }, require: name => {
            if (name in summaryDependencies) return summaryDependencies[name];
            if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
            return mocks[name];
        },
    });
    const service = new module.exports(); service.setSessionId('session-a');
    return { service, controls, calls, saved, events };
}

test('manual entire-session analysis includes early saved speech and the same pinned profile; recent uses last 30', async () => {
    const h = harness();
    await h.service.requestAnalysis('entire');
    assert.match(h.calls[0][2].content, /fact-1\n/);
    assert.match(h.calls[0][2].content, /fact-35/);
    assert.equal(h.calls[0][1].content, 'PINNED RESUME JD REFERENCE');
    assert.doesNotMatch(h.calls[0][0].content, /fact-1|PINNED/);
    assert.equal(h.service.getState().coveredTurns, 35);
    await h.service.requestAnalysis('recent');
    assert.doesNotMatch(h.calls[1][2].content, /fact-1\n/);
    assert.match(h.calls[1][2].content, /fact-6\n/);
    assert.equal(h.service.getState().coveredTurns, 30);
    assert.equal(h.saved.length, 2);
});

test('long entire-session analysis processes first, middle and final transcript parts without silent truncation', async () => {
    const h = harness([{ speaker: 'Me', text: 'FIRST_MARKER ' + 'a'.repeat(14000) + ' MIDDLE_MARKER ' + 'b'.repeat(14000) + ' FINAL_MARKER' }]);
    h.controls.chat = async messages => messages.at(-1).content.startsWith('Summarize') ? { content: 'Condensed factual notes for this part.' } : answer('All parts reviewed');
    await h.service.requestAnalysis('entire');
    assert.equal(h.calls.length, 4, 'three transcript parts followed by final synthesis');
    const sourceCalls = h.calls.slice(0, -1).map(messages => messages[2].content);
    assert.match(sourceCalls[0], /FIRST_MARKER/);
    assert.match(sourceCalls[1], /MIDDLE_MARKER/);
    assert.match(sourceCalls[2], /FINAL_MARKER/);
    assert.ok(sourceCalls.every(text => text.length < 12100));
    assert.ok(h.calls.every(messages => messages[1].content === 'PINNED RESUME JD REFERENCE'));
    assert.equal(h.service.getState().condensed, true);
    assert.equal(h.service.getState().coveredTurns, 1);
});

test('analyses are serialized and an older queued result cannot overwrite the newer requested result', async () => {
    const h = harness(); const pending = []; let active = 0, maximum = 0;
    h.controls.chat = () => { active++; maximum = Math.max(maximum, active); return new Promise(resolve => pending.push(value => { active--; resolve(value); })); };
    const older = h.service.requestAnalysis('recent'); await tick();
    const newer = h.service.requestAnalysis('entire'); await tick();
    assert.equal(h.calls.length, 1);
    pending[0](answer('Old result')); await older; await tick();
    assert.equal(h.calls.length, 2); assert.equal(h.saved.length, 0);
    pending[1](answer('New result')); await newer;
    assert.equal(maximum, 1); assert.equal(h.saved.length, 1);
    assert.match(h.service.previousAnalysisResult.summary.join(' '), /New result/);
});

test('pausing auto-update cancels its late result; manual analysis still works after Stop from stored transcripts', async () => {
    const h = harness(); let resolve;
    h.controls.chat = () => new Promise(done => { resolve = done; });
    for (let i = 0; i < 5; i++) h.service.addConversationTurn('Me', 'speech');
    await tick(); assert.equal(h.calls.length, 1);
    h.service.setAutoEnabled(false); resolve(answer('Unwanted auto result')); await h.service.queue;
    assert.equal(h.saved.length, 0);
    h.service.onSessionStopped();
    h.service.conversationHistory = [];
    h.controls.chat = async () => answer('Stopped session review');
    await h.service.requestAnalysis('entire');
    assert.equal(h.service.getState().isRecording, false);
    assert.equal(h.service.getState().sessionId, 'session-a');
    assert.equal(h.service.getState().coveredTurns, 35);
    assert.equal(h.saved.length, 1);
});

test('account changes, invalidated profiles and failed summary persistence cannot publish false success', async () => {
    const h = harness(); let resolve;
    h.controls.chat = () => new Promise(done => { resolve = done; });
    const pending = h.service.requestAnalysis('entire'); await tick();
    h.controls.owner = 'owner-b'; resolve(answer('Private old result')); await pending;
    assert.equal(h.saved.length, 0); assert.equal(h.service.getState().data, null);
    assert.throws(() => h.service.requestAnalysis('entire'), /Start or open/);
    h.controls.owner = 'owner-a';
    h.controls.chat = async () => answer('Save failure');
    h.controls.save = async () => { throw new Error('disk unavailable'); };
    await assert.rejects(h.service.requestAnalysis('entire'), /disk unavailable/);
    assert.equal(h.service.getState().phase, 'error'); assert.equal(h.service.previousAnalysisResult, null);
    h.controls.invalidate(['session-a']);
    assert.equal(h.service.getState().sessionId, null);
});

test('empty saved transcript and invalid scope are visible errors without provider calls', async () => {
    const h = harness([]);
    await assert.rejects(h.service.requestAnalysis('entire'), /No saved chat or transcript/);
    assert.equal(h.service.getState().phase, 'error'); assert.equal(h.calls.length, 0);
    assert.throws(() => h.service.requestAnalysis('unknown'), /Choose recent/);
});


test('automatic refresh waits for a manual full-session request and preserves its completed result first', async () => {
    const h = harness(); const pending = [];
    h.controls.chat = () => new Promise(resolve => pending.push(resolve));
    const manual = h.service.requestAnalysis('entire'); await tick();
    for (let i = 0; i < 5; i++) h.service.addConversationTurn('Me', 'New speech while analyzing.');
    assert.equal(h.calls.length, 1);
    pending[0](answer('Manual full-session result')); await manual; await tick();
    assert.equal(h.saved.length, 1);
    assert.match(h.saved[0].tldr, /Manual full-session/);
    assert.equal(h.calls.length, 2);
    pending[1](answer('Automatic next result')); await h.service.queue;
    assert.equal(h.saved.length, 2);
});

test('a new session cancels old analysis and coverage reflects speech added after a request snapshot', async () => {
    const h = harness(); let resolve;
    h.controls.chat = () => new Promise(done => { resolve = done; });
    const request = h.service.requestAnalysis('entire'); await tick();
    h.service.setSessionId('session-b'); h.service.resetConversationHistory();
    resolve(answer('Old private result')); await request;
    assert.equal(h.saved.length, 0);
    assert.equal(h.service.getState().sessionId, 'session-b');
    h.controls.chat = async () => {
        h.service.conversationHistory = Array.from({ length: 37 }, () => 'accepted speech');
        return answer('Only the requested 35 segments analyzed');
    };
    await h.service.requestAnalysis('entire');
    assert.equal(h.service.getState().coveredTurns, 35);
    assert.equal(h.service.getState().totalTurns, 37);
});


test('chat-only analysis works with audio off and labels generated answers as unverified drafts', async () => {
    const h = harness([]); h.service.setSessionId('session-a', { isRecording: false }); h.service.setScreenEnabled(false);
    h.controls.messages = [{ role: 'user', content: 'How should I design per-tenant queues?', sent_at: 1 }, { role: 'assistant', content: 'A draft partitioning proposal.', sent_at: 2 }];
    await h.service.requestAnalysis('entire');
    const request = h.calls[0];
    assert.match(request[2].content, /User question: How should I design per-tenant queues/);
    assert.match(request[2].content, /AI answer \(unverified draft\): A draft partitioning/);
    assert.match(request[0].content, /Audio is optional/);
    assert.equal(h.service.getState().isRecording, false);
    assert.deepEqual(JSON.parse(JSON.stringify(h.service.getState().sources)), { chat: 2, audio: 0, screen: 0, chatScreens: 0 });
    assert.equal(h.controls.captures, 0);
});

test('manual analysis combines chronological chat/audio, chat screenshots and a fresh current screen', async () => {
    const h = harness([{ speaker: 'Them', text: 'Spoken latency target.', start_at: 2 }]);
    h.controls.messages = [{ role: 'user', content: 'First chat question.', sent_at: 1 }, { role: 'assistant', content: 'Third item draft.', sent_at: { seconds: 3 } }];
    h.controls.images = [{ base64: 'old-chat-screen', mimeType: 'image/jpeg', origin: 'chat', capturedAt: 1000 }];
    h.controls.capture = async () => { h.controls.images.push({ base64: 'new-screen', mimeType: 'image/jpeg', origin: 'manual', capturedAt: 2000 }); return { captured: true }; };
    await h.service.requestAnalysis('entire');
    const content = h.calls[0][2].content;
    assert.ok(content[0].text.indexOf('First chat') < content[0].text.indexOf('Spoken latency'));
    assert.ok(content[0].text.indexOf('Spoken latency') < content[0].text.indexOf('Third item'));
    assert.deepEqual(Array.from(content.filter(part => part.type === 'image_url'), part => part.image_url.url), ['data:image/jpeg;base64,old-chat-screen', 'data:image/jpeg;base64,new-screen']);
    assert.equal(h.controls.captures, 1);
    assert.equal(h.service.getState().sources.chatScreens, 1);
    assert.equal(h.service.getState().coveredTurns, 5);
});

test('completed chat answers follow cadence without recording; automatic analysis uses cached screens', async () => {
    const h = harness([]); h.service.setSessionId('session-a', { isRecording: false });
    h.controls.messages = [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Answer' }];
    h.controls.images = [{ base64: 'chat-image', mimeType: 'image/jpeg', origin: 'chat', capturedAt: 1000 }];
    h.service.onChatMessageSaved('user'); await tick(); assert.equal(h.calls.length, 0);
    h.service.onChatMessageSaved('assistant');
    assert.equal(h.calls.length, 0, 'one completed answer waits for cadence');
    await h.service.scheduler.flush();
    assert.equal(h.calls.length, 1); assert.equal(h.controls.captures, 0);
    assert.equal(h.service.getState().sources.chat, 2);
    h.service.setAutoEnabled(false); await h.service.onChatMessageSaved('assistant');
    assert.equal(h.calls.length, 1);
});

test('screen-only manual analysis works; denied screens do not prevent chat insights and are reported', async () => {
    const screen = harness([]);
    screen.controls.images = [{ base64: 'screen-only', mimeType: 'image/jpeg', origin: 'manual', capturedAt: 1000 }];
    await screen.service.requestAnalysis('entire');
    assert.equal(screen.service.getState().sources.screen, 1);
    const chat = harness([]); chat.controls.messages = [{ role: 'user', content: 'Chat without screen permission.' }];
    chat.controls.capture = async () => ({ error: 'Screen recording access is not granted.' });
    await chat.service.requestAnalysis('entire');
    assert.match(chat.service.getState().screenNote, /not granted/);
    assert.equal(chat.service.getState().sources.screen, 0);
    assert.equal(chat.saved.length, 1);
});

test('models without vision fall back honestly to chat/audio and screen-only requests explain the limitation', async () => {
    const h = harness([]); h.controls.messages = [{ role: 'user', content: 'Text context.' }];
    h.controls.images = [{ base64: 'image', mimeType: 'image/jpeg', origin: 'manual', capturedAt: 1000 }];
    h.controls.chat = async messages => { if (Array.isArray(messages[2].content)) throw Error('Vision unsupported'); return answer('Text analysis'); };
    await h.service.requestAnalysis('entire');
    assert.equal(h.calls.length, 2); assert.equal(h.service.getState().sources.screen, 0);
    assert.match(h.service.getState().screenNote, /omitted/);
    const onlyScreen = harness([]); onlyScreen.controls.images = h.controls.images;
    onlyScreen.controls.chat = async () => { throw Error('Vision unsupported'); };
    await assert.rejects(onlyScreen.service.requestAnalysis('entire'), /model cannot analyze screen/);
});

test('account/session changes during screen capture cannot publish or submit old context', async () => {
    const h = harness([]); let done;
    h.controls.messages = [{ role: 'user', content: 'Private old chat.' }];
    h.controls.capture = () => new Promise(resolve => { done = resolve; });
    const request = h.service.requestAnalysis('entire'); await tick();
    h.controls.owner = 'owner-b'; done({ captured: true }); await request;
    assert.equal(h.calls.length, 0); assert.equal(h.saved.length, 0);
});


test('real Ollama image rejection retains its detail for text fallback; authentication errors are not retried', async () => {
    const requests = []; let status = 400;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/common/ai/providers/ollama.js'), 'utf8'), {
        module, exports: module.exports, setTimeout, console: { log() {}, error() {} },
        require: name => {
            if (name in summaryDependencies) return summaryDependencies[name];
            if (name === 'http') return {};
            if (name === 'node-fetch') return async (_url, options) => {
                const body = JSON.parse(options.body); requests.push(body);
                if (status !== 200 && body.messages.some(message => message.images?.length)) return { ok: false, status, statusText: status === 401 ? 'Unauthorized' : 'Bad Request', json: async () => ({ error: 'This model only supports one image' }) };
                return { ok: true, json: async () => ({ message: { content: answer('Text fallback').content } }) };
            };
            throw Error(name);
        },
    });
    const llm = module.exports.createLLM({ model: 'synthetic' });
    const h = harness([]); h.controls.messages = [{ role: 'user', content: 'Question' }];
    h.controls.images = [{ base64: 'one', mimeType: 'image/jpeg', origin: 'chat', capturedAt: 1000 }, { base64: 'two', mimeType: 'image/jpeg', origin: 'manual', capturedAt: 2000 }];
    h.controls.chat = messages => llm.chat(messages);
    await h.service.requestAnalysis('entire');
    assert.equal(requests.length, 2); assert.equal(h.service.getState().sources.screen, 0);
    assert.match(h.service.getState().screenNote, /omitted/);
    status = 401; requests.length = 0;
    await assert.rejects(h.service.requestAnalysis('entire'), /401 Unauthorized/);
    assert.equal(requests.length, 1);
});

test('successful manual refresh acknowledges pending content instead of scheduling an identical refresh', async () => {
    const h = harness();
    h.service.addConversationTurn('Me', 'Pending turn');
    assert.equal(h.service.scheduler.pending, 1);
    await h.service.requestAnalysis('recent');
    assert.equal(h.service.scheduler.pending, 0);
    await h.service.scheduler.flush();
    assert.equal(h.calls.length, 1);
});
