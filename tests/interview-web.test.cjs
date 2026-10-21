const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

function load(file, mocks) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        module, exports: module.exports, Buffer, process, URL,
        require(name) { return name in mocks ? mocks[name] : require(name); },
    });
    return module.exports;
}
function harness() {
    let owner = 'owner-a';
    const calls = [];
    const auth = { getCurrentUserId: () => owner };
    const context = {
        list: () => ({ profiles: [], selectedId: null }),
        activeLocalSession: () => null,
        selected: () => ({ id: 'profile-a' }),
        save: profile => { calls.push(['save', owner, profile]); return profile; },
        select: id => calls.push(['select', id]),
        ensureSession: () => { calls.push(['pin']); return 'session-a'; },
        snapshot: () => ({ packet: { name: 'Saved interview' } }),
        remove: () => ({ invalidatedSessions: ['active'] }),
    };
    const listen = { currentSessionId: 'active', closeSession: async () => { calls.push(['close-listen']); }, handleListenRequest: async action => calls.push(['listen', action]) };
    const actions = load('src/features/common/services/interviewActions.js', {
        './interviewContextService': context,
        './authService': auth,
        './interviewSourceService': require('../src/features/common/services/interviewSourceService'),
        '../../listen/listenService': listen,
        '../../ask/askService': { closeAskWindow: async () => calls.push(['close-ask']) },
        '../repositories/session': { endAllActiveSessions: async () => calls.push(['end', owner]) },
    });
    return { actions, auth, context, listen, calls, switchOwner: () => { owner = 'owner-b'; } };
}

test('website upload parses bytes without accepting a filesystem path and preserves source validation', async () => {
    const { actions } = harness();
    const source = await actions.run('import', { name: 'resume.txt', base64: Buffer.from('Actual candidate experience').toString('base64') }, 'owner-a');
    assert.equal(source.text, 'Actual candidate experience');
    assert.equal(source.name, 'resume.txt');
    await assert.rejects(actions.run('import', { name: 'resume.txt', filePath: '/private/resume.txt' }), /document smaller/);
    await assert.rejects(actions.run('import', { name: 'resume.pdf', base64: 'YQ==' }), /PDF import is not supported/);
    await assert.rejects(actions.run('import', { name: 'resume.txt', base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }), /smaller than 2 MiB/);
});

test('website start and stop reuse pinned desktop sessions and deletion stops the affected live session', async () => {
    const { actions, calls } = harness();
    assert.equal((await actions.run('start')).sessionId, 'session-a');
    assert.deepEqual(calls, [['close-listen'], ['close-ask'], ['end', 'owner-a'], ['pin']]);
    calls.length = 0;
    await actions.run('stop');
    assert.deepEqual(calls, [['close-listen'], ['close-ask'], ['end', 'owner-a'], ['select', null]]);
    calls.length = 0;
    await actions.run('remove', 'profile-a');
    assert.deepEqual(calls, [['close-listen']]);
});

test('starting interview context succeeds without opening an unavailable speech provider', async () => {
    const h = harness();
    h.listen.handleListenRequest = async () => { throw new Error('Speech provider unavailable'); };
    const result = await h.actions.run('start');
    assert.equal(result.sessionId, 'session-a');
    assert.equal(result.recording, false);
    assert.equal(result.snapshot.packet.name, 'Saved interview');
});

test('stale website owner cannot save or continue a start after desktop account changes', async () => {
    const h = harness();
    await assert.rejects(h.actions.run('save', {}, 'wrong-owner'), /User changed/);
    assert.equal(h.calls.length, 0);
    h.listen.closeSession = async () => { h.switchOwner(); };
    await assert.rejects(h.actions.run('start', undefined, 'owner-a'), /User changed/);
    assert.equal(h.calls.length, 0, 'must not close Ask, pin context or open audio for the next owner');
});

test('interview HTTP API requires the local website and binds ownership to the desktop', async () => {
    const h = harness();
    const oldWeb = process.env.pickleglass_WEB_URL;
    const oldApi = process.env.pickleglass_API_URL;
    process.env.pickleglass_WEB_URL = 'http://localhost:64980';
    const router = load('pickleglass_web/backend_node/routes/interviews.js', {
        '../../../src/features/common/services/authService': h.auth,
        '../../../src/features/common/services/interviewActions': h.actions,
    });
    const app = express(); app.use(express.json({ limit: '3mb' })); app.use('/api/interviews', router);
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${server.address().port}`;
    process.env.pickleglass_API_URL = url;
    const headers = { Origin: 'http://localhost:64980', 'X-Interview-Client': 'website', 'Content-Type': 'application/json', 'X-User-ID': 'spoofed-owner' };
    try {
        assert.equal((await fetch(url + '/api/interviews')).status, 403);
        assert.equal((await fetch(url + '/api/interviews', { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
        const rebound = await new Promise((resolve, reject) => {
            require('node:http').get(url + '/api/interviews', { headers: { ...headers, Host: 'other.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
        });
        assert.equal(rebound, 403);
        const response = await fetch(url + '/api/interviews', { headers });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json()).ownerId, 'owner-a');
        const post = body => fetch(url + '/api/interviews/save', { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal((await post({ ownerId: 'spoofed-owner', payload: {} })).status, 409);
        const saved = await post({ ownerId: 'owner-a', payload: { name: 'Saved interview' } });
        assert.equal(saved.status, 200);
        assert.equal(h.calls[0][1], 'owner-a');
        h.switchOwner();
        assert.equal((await post({ ownerId: 'owner-a', payload: {} })).status, 409);
        assert.equal(h.calls.length, 1);
        const unavailable = await fetch(url + '/api/interviews/filesystem', { method: 'POST', headers, body: '{}' });
        assert.equal(unavailable.status, 404);
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (oldWeb === undefined) delete process.env.pickleglass_WEB_URL; else process.env.pickleglass_WEB_URL = oldWeb;
        if (oldApi === undefined) delete process.env.pickleglass_API_URL; else process.env.pickleglass_API_URL = oldApi;
    }
});

test('desktop Interview Context opens the existing website tab instead of creating a separate window', async () => {
    const opened = [];
    const oldWeb = process.env.pickleglass_WEB_URL;
    process.env.pickleglass_WEB_URL = 'http://localhost:64980';
    try {
        const entry = load('src/features/common/services/interviewWindow.js', { electron: { shell: { openExternal: async url => opened.push(url) } } });
        await entry.open();
        assert.deepEqual(opened, ['http://localhost:64980/personalize?tab=interview']);
    } finally { if (oldWeb === undefined) delete process.env.pickleglass_WEB_URL; else process.env.pickleglass_WEB_URL = oldWeb; }
});


test('interview start/stop surface incomplete session saves instead of claiming successful completion', async () => {
    for (const action of ['start', 'stop']) {
        const h = harness();
        h.listen.closeSession = async () => ({ success: false, error: 'Final transcript save failed' });
        await assert.rejects(h.actions.run(action), /Final transcript save failed/);
        assert.deepEqual(h.calls, [], 'must not start new capture or switch to generic mode after a failed final save');
    }
});
