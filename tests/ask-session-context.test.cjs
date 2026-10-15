const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(transcripts = [], chunks = [], interview = null, failImage = false, controls = {}) {
    const calls = { sessions: [], prompts: [] };
    const window = { isDestroyed: () => false, webContents: { send() {} } };
    const mocks = {
        '../common/services/interviewContextService': { on(event, callback) { if (event === 'invalidated') controls.invalidate = callback; }, context: () => interview || ({ context: null }), snapshot: () => null },
        electron: { BrowserWindow: {}, desktopCapturer: { getSources: async () => failImage ? [{ thumbnail: { toJPEG: () => Buffer.from('synthetic-image'), getSize: () => ({ width: 10, height: 10 }) } }] : [] } },
        '../common/ai/factory': { createStreamingLLM: () => ({ streamChat: async messages => {
            calls.prompts.push(messages);
            if (failImage && calls.prompts.length === 1) throw new Error('image unsupported');
            if (controls.fallback && calls.prompts.length === 2) return controls.fallback;
            let offset=0;
            return { body: { getReader: () => ({ read: async () => offset<chunks.length ? {done:false,value:chunks[offset++]} : {done:true} }) } };
        } }) },
        '../../window/windowManager': { windowPool: new Map([['ask', window]]) },
        '../../bridge/internalBridge': { emit() {} },
        '../common/repositories/session': { getOrCreateActive: async () => 'active-listen-session' },
        './repositories': { addAiMessage: async () => {} },
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
        process: { platform: 'linux' }, console: { log() {}, warn() {}, error() {} },
        require(name) {
            if (name in mocks) return mocks[name];
            if (name === 'sharp') throw new Error('not used');
            return require(name);
        } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/ask/askService.js'), 'utf8'), sandbox);
    return { service: module.exports, calls };
}

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
