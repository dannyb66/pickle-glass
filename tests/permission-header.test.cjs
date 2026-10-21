const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness() {
    const events = new EventEmitter(); const visibility = new EventEmitter(); const timers = new Map();
    const state = { mode: 'local', microphone: 'granted', screen: 'denied', keychain: 'granted' };
    const calls = { checks: 0, continued: 0, restarted: 0, preferences: [], keychainMarks: 0 };
    const controls = {}; const sizes = [];
    const api = {
        common: { getCurrentUser: async () => { if (controls.userError) throw new Error('Account service unavailable'); return { mode: state.mode }; }, quitApplication() {} },
        permissionHeader: {
            checkSystemPermissions: async () => { calls.checks++; if (controls.checkError) throw new Error('Permission service unavailable'); return controls.permissions || { ...state }; },
            requestMicrophonePermission: async () => ({ success: true }),
            openSystemPreferences: async value => { calls.preferences.push(value); return { success: true }; },
            initializeEncryptionKey: async () => ({ success: true }),
            markKeychainCompleted: async () => { calls.keychainMarks++; return { success: true }; },
            restartApplication: async () => { calls.restarted++; if (controls.restartError) return { success: false, error: 'Restart failed' }; return controls.restartResult || { success: true }; },
        },
    };
    class LitElement {
        connectedCallback() {} disconnectedCallback() {} updated() {}
        dispatchEvent(event) { sizes.push(event.detail); }
    }
    let Header;
    const source = fs.readFileSync(path.join(__dirname, '../src/ui/app/PermissionHeader.js'), 'utf8')
        .replace(/^import .*;\n/, '').replace('export class PermissionHeader', 'class PermissionHeader');
    const html = (strings, ...values) => strings.reduce((text, part, i) => text + part + (typeof values[i] === 'function' ? '' : values[i] ?? ''), '');
    const window = { api, addEventListener: (name, cb) => events.on(name, cb), removeEventListener: (name, cb) => events.removeListener(name, cb) };
    const document = { visibilityState: 'visible', addEventListener: (name, cb) => visibility.on(name, cb), removeEventListener: (name, cb) => visibility.removeListener(name, cb) };
    vm.runInNewContext(source, {
        LitElement, html, css: html, window, document,
        setInterval: cb => { const id = Symbol(); timers.set(id, cb); return id; }, clearInterval: id => timers.delete(id),
        CustomEvent: class { constructor(name, options) { this.name = name; this.detail = options.detail; } },
        customElements: { define: (_name, value) => { Header = value; } },
    });
    const header = new Header();
    header.continueCallback = async () => { calls.continued++; if (controls.continueError) throw new Error('Model setup failed'); if (controls.continuation) return controls.continuation; };
    return { header, state, calls, controls, events, visibility, timers, sizes, api, document };
}

test('denied screen stays blocked; focus and visibility recheck actual grants and continue exactly once', async () => {
    const h = harness(); h.header.connectedCallback(); await settle();
    assert.equal(h.calls.continued, 0);
    assert.match(h.header.render(), /Screen recording: denied/);
    assert.match(h.header.render(), /remove the old Glass entry/);
    assert.match(h.header.render(), /\/Applications\/Glass.app/);
    h.state.screen = 'granted'; h.events.emit('focus'); await settle();
    h.visibility.emit('visibilitychange'); await settle();
    for (const timer of h.timers.values()) timer(); await settle();
    assert.equal(h.calls.continued, 1);
    h.header.disconnectedCallback();
});

test('screen granted cannot bypass denied microphone or required keychain', async () => {
    const h = harness(); h.state.screen = 'granted'; h.state.microphone = 'denied';
    h.header.connectedCallback(); await settle();
    await h.header.handleContinue(); assert.equal(h.calls.continued, 0);
    await h.header.handleMicrophoneClick(); assert.equal(h.header.microphoneGranted, 'denied', 'an action success flag is not permission proof');
    h.state.microphone = 'granted'; h.state.mode = 'firebase'; h.state.keychain = 'denied';
    await h.header.handleCheckAgain(); assert.equal(h.calls.continued, 0);
    h.state.keychain = 'granted'; await h.header.handleCheckAgain();
    assert.equal(h.calls.continued, 1); assert.equal(h.calls.keychainMarks, 1);
    h.header.disconnectedCallback();
});

test('continuation is awaited, guarded against repeats, and manually retryable after failure', async () => {
    const h = harness(); h.state.screen = 'granted'; h.controls.continueError = true;
    h.header.connectedCallback(); await settle();
    assert.equal(h.calls.continued, 1); assert.match(h.header.errorMessage, /Model setup failed/);
    h.events.emit('focus'); await settle(); assert.equal(h.calls.continued, 1, 'polling cannot repeatedly trigger failed transitions');
    h.controls.continueError = false; const pending = deferred(); h.controls.continuation = pending.promise;
    const retry = h.header.handleContinue(); await settle();
    assert.equal(h.header.isContinuing, true); await h.header.handleContinue();
    assert.equal(h.calls.continued, 2);
    pending.resolve({ success: true }); await retry;
    h.events.emit('focus'); await settle(); assert.equal(h.calls.continued, 2);
    h.header.disconnectedCallback();
});

test('disconnect removes named listeners and timers, and pending checks cannot continue or create leaked timers', async () => {
    const h = harness(); const pending = deferred(); h.controls.permissions = pending.promise;
    h.header.connectedCallback(); await settle();
    assert.equal(h.events.listenerCount('focus'), 1); assert.equal(h.timers.size, 1);
    h.header.disconnectedCallback();
    assert.equal(h.events.listenerCount('focus'), 0); assert.equal(h.visibility.listenerCount('visibilitychange'), 0); assert.equal(h.timers.size, 0);
    pending.resolve({ microphone: 'granted', screen: 'granted', keychain: 'granted' }); await settle();
    assert.equal(h.calls.continued, 0); assert.equal(h.timers.size, 0);
    h.controls.permissions = undefined; h.header.connectedCallback(); await settle();
    assert.equal(h.calls.checks, 2, 'reconnected element can check again after a stale pending operation');
    h.header.disconnectedCallback();
});

test('Check again exposes service errors and Restart Glass invokes only the restart API', async () => {
    const h = harness(); h.controls.checkError = true; h.header.connectedCallback(); await settle();
    assert.match(h.header.errorMessage, /Permission service unavailable/);
    assert.match(h.header.render(), /role="alert"/); assert.equal(h.calls.continued, 0);
    h.controls.checkError = false; await h.header.handleCheckAgain(); assert.equal(h.header.errorMessage, '');
    await h.header.handleScreenClick(); assert.deepEqual(h.calls.preferences, ['screen-recording']);
    h.controls.restartError = true; await h.header.handleRestart(); assert.match(h.header.errorMessage, /Restart failed/);
    h.controls.restartError = false; await h.header.handleRestart(); assert.equal(h.calls.restarted, 2); assert.equal(h.calls.continued, 0);
    h.controls.userError = true; h.state.screen = 'granted'; await h.header.handleCheckAgain();
    assert.match(h.header.errorMessage, /Account service unavailable/); assert.equal(h.calls.continued, 0);
    h.header.disconnectedCallback();
});

test('Restart disables immediately, ignores repeated clicks, and only retries after failure', async () => {
    const h = harness(); h.header.connectedCallback(); await settle();
    const pending = deferred(); h.controls.restartResult = pending.promise;
    const first = h.header.handleRestart();
    assert.equal(h.header.isRestarting, true);
    assert.match(h.header.render(), /Restarting…/);
    await h.header.handleRestart(); assert.equal(h.calls.restarted, 1);
    pending.resolve({ success: false, error: 'Restart denied' }); await first;
    assert.equal(h.header.isRestarting, false); assert.match(h.header.errorMessage, /Restart denied/);
    h.controls.restartResult = undefined;
    await h.header.handleRestart(); assert.equal(h.calls.restarted, 2); assert.equal(h.header.isRestarting, true);
    await h.header.handleRestart(); assert.equal(h.calls.restarted, 2, 'successful restart stays locked while quit is pending');
    h.header.disconnectedCallback();
});

test('content height changes request matching native window resize', async () => {
    const h = harness(); h.header.connectedCallback(); await settle();
    h.header.shadowRoot = { querySelector: () => ({ getBoundingClientRect: () => ({ height: 428.4 }) }) };
    h.header.updated(new Map()); h.header.updated(new Map());
    assert.deepEqual(h.sizes.map(value => value.height), [429]);
    h.header.disconnectedCallback();
});
