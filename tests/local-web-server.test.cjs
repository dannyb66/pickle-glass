const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { DEFAULT_WEB_PORT, getAvailablePort, createFrontend } = require('../src/features/common/services/localWebServer');

async function listen(app, port = 0) {
    return new Promise(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
}
const close = server => new Promise(resolve => server.close(resolve));

test('website serves API and its own uncached runtime config through one origin', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-web-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'index.html'), 'Glass website');
    fs.writeFileSync(path.join(dir, 'personalize.html'), 'Interview profiles');
    const api = express(); api.use(express.json());
    api.get('/', (_req, res) => res.json({ apiRoot: true }));
    api.post('/api/interviews/start', (req, res) => res.json({ owner: req.body.ownerId, pinned: true }));
    const servers = [];
    t.after(async () => { await Promise.all(servers.map(close)); });
    const configs = [{ API_URL: 'first-server' }, { API_URL: 'second-server' }];
    for (const config of configs) servers.push(await listen(createFrontend({ nodeApi: api, staticDir: dir, runtimeConfig: config })));
    for (const [i, server] of servers.entries()) {
        const url = `http://127.0.0.1:${server.address().port}`;
        assert.equal(await (await fetch(url)).text(), 'Glass website');
        assert.equal(await (await fetch(url + '/personalize?tab=interview')).text(), 'Interview profiles');
        const runtime = await fetch(url + '/runtime-config.json');
        assert.equal(runtime.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await runtime.json(), configs[i]);
        const start = await fetch(url + '/api/interviews/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: 'synthetic-owner' }) });
        assert.deepEqual(await start.json(), { owner: 'synthetic-owner', pinned: true });
    }
});

test('stable preferred website port survives restarts and a busy port falls back safely', async () => {
    assert.equal(DEFAULT_WEB_PORT, 64980);
    const preferred = await getAvailablePort();
    assert.equal(await getAvailablePort(preferred), preferred);
    const busy = await listen(express(), preferred);
    try { assert.notEqual(await getAvailablePort(preferred), preferred); }
    finally { await close(busy); }
    assert.equal(await getAvailablePort(preferred), preferred);
});
