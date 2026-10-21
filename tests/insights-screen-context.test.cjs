const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
    const controls = { owner: 'a', screen: 'granted', empty: false, source: async () => [{ thumbnail: {
        isEmpty: () => controls.empty, toJPEG: () => Buffer.from('current-screen'),
    } }] };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/features/common/services/insightsScreenContext'), 'utf8'), {
        module, exports: module.exports, process: { platform: 'darwin' },
        require(name) {
            if (name === 'electron') return { systemPreferences: { getMediaAccessStatus: () => controls.screen }, desktopCapturer: { getSources: () => controls.source() } };
            if (name === './authService') return { getCurrentUserId: () => controls.owner };
            return require(name);
        },
    });
    const service = module.exports;
    const remember = (text, session = 'session', owner = 'a', origin = 'chat') => service.remember(session, owner, { success: true, base64: Buffer.from(text).toString('base64') }, origin);
    return { service, controls, remember };
}

test('screen context retains five chat snapshots plus the latest analysis capture and deduplicates images', async () => {
    const h = harness();
    for (let i = 0; i < 8; i++) h.remember(`chat-${i}`);
    h.remember('manual-old', 'session', 'a', 'manual');
    await h.service.capture('session', 'a');
    const images = h.service.get('session', 'a');
    assert.equal(images.length, 6);
    assert.equal(images.filter(image => image.origin === 'chat').length, 5);
    assert.equal(images.filter(image => image.origin === 'manual').length, 1);
    assert.ok(!images.some(image => image.base64 === Buffer.from('manual-old').toString('base64')));
    h.remember('chat-7'); assert.equal(h.service.get('session', 'a').length, 6);
    h.service.clear('session'); assert.equal(h.service.get('session', 'a').length, 0);
});

test('screen cache is bounded across sessions and rejects other accounts and oversized images', () => {
    const h = harness();
    for (let i = 0; i < 4; i++) h.remember('screen', `session-${i}`);
    assert.equal(h.service.get('session-0', 'a').length, 0);
    h.controls.owner = 'b';
    assert.equal(h.service.get('session-3', 'a').length, 0);
    h.remember('wrong owner', 'session-3', 'a');
    assert.equal(h.service.get('session-3', 'b').length, 0);
    h.service.remember('huge', 'b', { success: true, base64: 'x'.repeat(4 * 1024 * 1024 + 1) });
    assert.equal(h.service.get('huge', 'b').length, 0);
});

test('denied or empty captures report an error and cancellation cannot cache an image', async () => {
    const h = harness(); h.controls.screen = 'denied';
    assert.match((await h.service.capture('session', 'a')).error, /not granted/);
    h.controls.screen = 'granted'; h.controls.empty = true;
    assert.match((await h.service.capture('session', 'a')).error, /No screen image/);
    let done; h.controls.source = () => new Promise(resolve => { done = resolve; });
    let current = true; const capture = h.service.capture('session', 'a', () => current);
    current = false; done([{ thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('private') } }]);
    assert.match((await capture).error, /Session changed/);
    assert.equal(h.service.get('session', 'a').length, 0);
});
