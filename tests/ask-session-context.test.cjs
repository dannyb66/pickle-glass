const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function harness(transcripts = [], chunks = [], interview = null, failImage = false, controls = {}) {
    const bridge = new EventEmitter();
    controls.bridge = bridge;
    const calls = { activeSessionRequests: 0, sessions: [], prompts: [], focuses: 0, appFocuses: 0, webFocuses: 0, states: [], screens: [], composerRequests: [] };
    const window = {
        isDestroyed: () => false,
        isVisible: () => true,
        isFocused: () => !!controls.focused,
        focus() { calls.focuses++; },
        webContents: { focus() { calls.webFocuses++; }, send(channel, state) {
            if (channel === 'ask:stateUpdate') calls.states.push({ ...state });
            if (channel === 'ask:showTextInput') calls.composerRequests.push({ ...state });
        } },
    };
    const mocks = {
        '../common/services/interviewContextService': { on(event, callback) { if (event === 'invalidated') controls.invalidate = callback; }, context: () => interview || ({ context: null }), snapshot: () => null },
        electron: { app: { focus: () => calls.appFocuses++ }, BrowserWindow: {}, desktopCapturer: { getSources: async () => failImage ? [{ thumbnail: { toJPEG: () => Buffer.from('synthetic-image'), getSize: () => ({ width: 10, height: 10 }) } }] : [] } },
        '../common/ai/factory': { createStreamingLLM: () => ({ streamChat: async messages => {
            calls.prompts.push(messages);
            if (failImage && calls.prompts.length === 1) throw new Error('image unsupported');
            if (controls.fallback && calls.prompts.length === 2) return controls.fallback;
            let offset=0;
            return { body: { getReader: () => ({ cancel: async () => {}, read: async () => offset<chunks.length ? {done:false,value:chunks[offset++]} : {done:true} }) } };
        } }) },
        '../../window/windowManager': { windowPool: new Map([['ask', window]]) },
        '../../bridge/internalBridge': bridge,
        '../common/repositories/session': {
            getOrCreateActive: async () => { calls.activeSessionRequests++; return controls.activeSession ? controls.activeSession() : 'active-listen-session'; },
            getById: async id => ({ id, uid: controls.sessionOwner || 'owner-a', ended_at: 123 }),
        },
        '../common/services/insightsScreenContext': { remember: (...args) => calls.screens.push(args) },
        '../common/services/authService': { getCurrentUserId: () => controls.owner || 'owner-a' },
        './repositories': { addAiMessage: async entry => controls.save?.(entry) },
        '../common/prompts/promptBuilder': { getSystemPrompt: (kind, context) => context },
        '../common/services/modelStateService': { getCurrentModelInfo: async () => ({ provider: 'openai', apiKey: 'synthetic', model: 'synthetic' }) },
        '../listen/stt/repositories': { getAllTranscriptsBySessionId: async sessionId => {
            calls.sessions.push(sessionId);
            if (transcripts instanceof Error) throw transcripts;
            return transcripts;
        } },
    };
    const module = { exports: {} };
    const sandbox = { module, exports: module.exports, Buffer, TextDecoder, AbortController,
        process: { platform: controls.platform || 'linux' }, console: { log() {}, warn() {}, error() {} },
        require(name) {
            if (name in mocks) return mocks[name];
            if (name === 'sharp') throw new Error('not used');
            return require(name);
        } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/ask/askService.js'), 'utf8'), sandbox);
    return { service: module.exports, calls };
}

test('Cmd+Enter activates the Ask window when revealing follow-up input', async t => {
    for (const content of [{ currentResponse: 'Previous answer' }, { isLoading: true }, { isStreaming: true }]) {
        await t.test(JSON.stringify(content), async () => {
            const { service, calls } = harness();
            Object.assign(service.state, content, { showTextInput: false });

            await service.toggleAskButton(true);

            assert.equal(service.state.showTextInput, true);
            assert.equal(calls.focuses, 1, 'activate the native window so the focused renderer input receives typing');
            assert.equal(calls.states.at(-1).showTextInput, true);
            assert.equal(calls.prompts.length, 0, 'revealing follow-up input must not submit another request');
        });
    }
});

test('Ask button always focuses the composer and never hides it', async () => {
    const { service, calls } = harness();
    Object.assign(service.state, { currentResponse: 'Previous answer', showTextInput: false });

    await service.toggleAskButton();
    assert.equal(calls.focuses, 1);

    await service.toggleAskButton();
    assert.equal(service.state.showTextInput, true);
    assert.equal(calls.focuses, 2);
    assert.ok(calls.composerRequests.every(request => request.submit === false));
});

test('Cmd+Enter returning from another app focuses without submitting an empty replacement', async () => {
    const { service, calls } = harness();
    const submissions = [];
    service.sendMessage = async (...args) => submissions.push(args);

    await service.toggleAskButton(true);

    assert.equal(submissions.length, 0);
    assert.equal(calls.composerRequests.at(-1).submit, false);
    assert.equal(calls.focuses, 1);
});

test('Cmd+Enter in focused Ask asks the renderer to submit its draft', async () => {
    const { service, calls } = harness([], [], null, false, { focused: true });
    await service.toggleAskButton(true);
    assert.equal(calls.composerRequests.at(-1).submit, true);
    assert.equal(calls.prompts.length, 0, 'only the renderer knows the unsent input');
});

test('explicit Ask activation also activates the Mac app and its web contents', async () => {
    const { service, calls } = harness([], [], null, false, { platform: 'darwin' });
    await service.toggleAskButton(true);
    assert.equal(calls.appFocuses, 1);
    assert.equal(calls.focuses, 1);
    assert.equal(calls.webFocuses, 1);
});

test('Ask composer remains available throughout loading, streaming and completion', async () => {
    const chunks = [Buffer.from('data: {"choices":[{"delta":{"content":"Synthetic answer"}}]}\n')];
    const { service, calls } = harness([], chunks);
    await service.sendMessage('A question while another answer is visible');
    assert.ok(calls.states.some(state => state.isLoading));
    assert.ok(calls.states.some(state => state.isStreaming));
    assert.ok(calls.states.every(state => state.showTextInput));
    assert.equal(service.state.showTextInput, true);
});

test('an older cancelled question cannot reset the state of a newer question', async () => {
    let release, releaseNew;
    const pendingSession = new Promise(resolve => { release = resolve; });
    const pendingNewSession = new Promise(resolve => { releaseNew = resolve; });
    let requests = 0;
    const controls = { activeSession: () => ++requests === 1 ? pendingSession : pendingNewSession };
    const { service } = harness([], [], null, false, controls);
    const oldQuestion = service.sendMessage('Old question');
    const newQuestion = service.sendMessage('New question');
    const stateAfterNewQuestion = JSON.stringify(service.state);
    release('active-listen-session');
    await oldQuestion;
    assert.equal(JSON.stringify(service.state), stateAfterNewQuestion);
    assert.equal(service.state.currentQuestion, 'New question');
    releaseNew('active-listen-session');
    await newQuestion;
});

test('ordinary Ask includes real stored transcripts from the active session in its model request', async () => {
    const { service, calls } = harness([{ speaker: 'Me', text: 'Audio-only rollback owner is Mira.' }, { speaker: 'Them', text: 'Load is 42 requests per second.' }]);
    assert.equal((await service.sendMessage('Combine the screen target and spoken load.')).success, true);
    assert.deepEqual(calls.sessions, ['active-listen-session']);
    assert.match(calls.prompts[0][0].content, /Me: Audio-only rollback owner is Mira/);
    assert.match(calls.prompts[0][0].content, /Them: Load is 42/);
});

test('explicit screen-only context never loads session audio', async () => {
    const { service, calls } = harness([{ speaker: 'Me', text: 'Do not include this audio.' }]);
    assert.equal((await service.sendMessage('Read the screen.', [])).success, true);
    assert.deepEqual(calls.sessions, []);
    assert.doesNotMatch(calls.prompts[0][0].content, /Do not include/);
});

test('no transcript is reported honestly and explicit supplied context stays compatible', async () => {
    const empty = harness([{ text: '' }, { text: null }]);
    assert.equal((await empty.service.sendMessage('Read screen.')).success, true);
    assert.equal(empty.calls.prompts[0][0].content, 'No conversation history available.');
    const explicit = harness();
    await explicit.service.sendMessage('Use supplied context.', ['Them: explicit context']);
    assert.deepEqual(explicit.calls.sessions, []);
    assert.match(explicit.calls.prompts[0][0].content, /explicit context/);
});

test('failed transcript retrieval stops the request instead of implying audio context was used', async () => {
    const { service, calls } = harness(new Error('Transcript storage unavailable'));
    const result = await service.sendMessage('Use meeting audio.');
    assert.equal(result.success, false);
    assert.match(result.error, /Transcript storage unavailable/);
    assert.equal(calls.prompts.length, 0);
});


test('network chunk boundaries preserve complete SSE facts and split UTF-8 characters', async () => {
    const wire = Buffer.from('data: {"choices":[{"delta":{"content":"Bluebird → "}}]}\n\ndata: {"choices":[{"delta":{"content":"us-west-2"}}]}\n\ndata: [DONE]\n\n');
    const chunks = [...wire].map(byte => Uint8Array.of(byte));
    const { service } = harness([], chunks);
    assert.equal((await service.sendMessage('Read both sources.')).success, true);
    assert.equal(service.state.currentResponse, 'Bluebird → us-west-2');
});

test('last SSE event without a trailing newline is processed when the stream ends', async () => {
    const chunk = Buffer.from('data: {"choices":[{"delta":{"content":"180 ms"}}]}');
    const { service } = harness([], [chunk]);
    await service.sendMessage('Read the target.');
    assert.equal(service.state.currentResponse, '180 ms');
});


test('interview context reaches Ask and image fallback with the same pinned packet, never inside system data', async () => {
    const interview = { policy: 'Trusted system design policy', context: { role: 'user', content: 'PINNED ORCHID RESUME + JD + REFERENCES' } };
    const { service, calls } = harness([{ speaker: 'Them', text: 'Current interview audio.' }], [], interview, true);
    assert.equal((await service.sendMessage('Design this API.')).success, true);
    assert.equal(calls.prompts.length, 2);
    for (const messages of calls.prompts) {
        assert.match(messages[0].content, /Trusted system design policy/);
        assert.doesNotMatch(messages[0].content, /ORCHID|Current interview audio/);
        assert.equal(messages[1].content, interview.context.content);
        assert.match(messages[2].content, /Current interview audio/);
        assert.doesNotMatch(JSON.stringify(messages), /WILLOW/);
    }
    assert.ok(calls.prompts[0].at(-1).content.some(part => part.type === 'image_url'));
    assert.equal(typeof calls.prompts[1].at(-1).content, 'string');
});


test('deleting context while a text fallback awaits headers cancels its reader and reports failure', async () => {
    let resolve; const controls = { fallback: new Promise(done => { resolve = done; }) };
    const { service, calls } = harness([], [], { policy: 'trusted', context: { role: 'user', content: 'pinned context' } }, true, controls);
    const request = service.sendMessage('Design the API.');
    while (calls.prompts.length < 2) await new Promise(done => setImmediate(done));
    controls.invalidate(['active-listen-session']); let cancelled = 0; let reads = 0;
    resolve({ body: { getReader: () => ({ cancel: async () => { cancelled++; }, read: async () => { reads++; return { done: true }; } }) } });
    const result = await request;
    assert.equal(result.success, false); assert.match(result.error, /cancelled/); assert.equal(cancelled, 1); assert.equal(reads, 0);
});


test('insight follow-ups retain the completed reviewed session and its pinned profile across questions', async () => {
    const controls = {};
    const h = harness([{ speaker: 'Them', text: 'Persisted final interview question.' }], [], { policy: 'Reviewed policy', context: { role: 'user', content: 'REVIEWED RESUME JD' } }, false, controls);
    assert.equal((await h.service.sendMessageForSession('Explain this insight.', 'completed-session')).success, true);
    assert.equal((await h.service.sendMessage('And the failure tradeoff?')).success, true);
    assert.deepEqual(h.calls.sessions, ['completed-session', 'completed-session']);
    assert.equal(h.calls.activeSessionRequests, 0, 'review must not create a new generic session');
    assert.match(h.calls.prompts[0][1].content, /REVIEWED RESUME JD/);
    assert.match(JSON.stringify(h.calls.prompts[1]), /Persisted final interview question/);
    controls.bridge.emit('listen:sessionStarted', { sessionId: 'new-listen' });
    await h.service.sendMessage('New live question.');
    assert.equal(h.calls.activeSessionRequests, 1);
    assert.equal(h.calls.sessions.at(-1), 'active-listen-session');
});

test('review cannot open another owner session or survive an account change', async () => {
    const controls = { sessionOwner: 'owner-b' };
    const h = harness([], [], null, false, controls);
    await assert.rejects(h.service.sendMessageForSession('Read private transcript.', 'foreign'), /unavailable/);
    assert.equal(h.calls.prompts.length, 0);
    controls.sessionOwner = 'owner-a';
    await h.service.sendMessageForSession('Read my transcript.', 'review');
    controls.owner = 'owner-b';
    const result = await h.service.sendMessage('More detail.');
    assert.equal(result.success, false);
    assert.match(result.error, /Reviewed session changed/);
    assert.equal(h.calls.prompts.length, 1);
});


test('saved chat events carry the session/owner and successful screenshots become Insights context', async () => {
    const wire = Buffer.from('data: {"choices":[{"delta":{"content":"Saved answer"}}]}\n\ndata: [DONE]\n\n');
    const controls = {}; const h = harness([], [wire], null, true, controls); const events = [];
    controls.bridge.on('ask:messageSaved', event => events.push(event));
    await h.service.sendMessage('Question with a screen');
    assert.deepEqual(events.map(event => [event.sessionId, event.owner, event.role]), [['active-listen-session', 'owner-a', 'user'], ['active-listen-session', 'owner-a', 'assistant']]);
    assert.equal(h.calls.screens.length, 1);
    assert.equal(h.calls.screens[0][0], 'active-listen-session');
    assert.equal(h.calls.screens[0][1], 'owner-a');
});


test('closing Ask during pending user/assistant persistence cannot reattach an old Insights session', async t => {
    for (const role of ['user', 'assistant']) await t.test(role, async () => {
        let finish, entered; const saving = new Promise(resolve => { entered = resolve; });
        const pending = new Promise(resolve => { finish = resolve; });
        const controls = { save: entry => { if (entry.role === role) { entered(); return pending; } } };
        const wire = Buffer.from('data: {"choices":[{"delta":{"content":"Old draft"}}]}\n\ndata: [DONE]\n\n');
        const h = harness([], [wire], null, false, controls); const events = [];
        controls.bridge.on('ask:messageSaved', event => events.push(event));
        const request = h.service.sendMessage('Old question');
        await saving; await h.service.closeAskWindow(); finish(); await request;
        assert.equal(events.filter(event => event.role === role).length, 0);
    });
});
