const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const quiet = { log() {}, warn() {}, error() {} };

function harness(platform = 'darwin', stored) {
    const ipc = new EventEmitter();
    const registered = new Map();
    const requests = [];
    const writes = [];
    const controls = { complete: true, success: true, failInvoke: false, insightsVisible: false, insightsToggles: 0 };
    let api;
    const ipcRenderer = {
        on: (channel, callback) => ipc.on(channel, callback),
        removeListener: (channel, callback) => ipc.removeListener(channel, callback),
        async invoke(channel, text) {
            if (channel === 'insights:refresh') {
                if (controls.failInvoke) throw new Error('IPC failed');
                controls.insightsToggles++;
                controls.insightsVisible = true;
                ipc.emit('listen:insightsVisibility', {}, controls.insightsVisible);
                return controls.insightsVisible;
            }
            if (channel !== 'listen:changeSession') throw new Error(`Unexpected IPC: ${channel}`);
            requests.push(text);
            if (controls.failInvoke) throw new Error('IPC failed');
            if (controls.sessionHandler) return controls.sessionHandler(text);
            if (controls.complete) ipc.emit('listen:changeSessionResult', {}, { success: controls.success });
            return { success: controls.success };
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8'), {
        process: { platform },
        require: name => {
            assert.equal(name, 'electron');
            return { contextBridge: { exposeInMainWorld: (name, value) => { api = value; } }, ipcRenderer };
        },
    });
    class LitElement {
        connectedCallback() {}
        disconnectedCallback() {}
        addEventListener() {}
        removeEventListener() {}
    }
    let Header;
    const source = fs.readFileSync(path.join(__dirname, '../src/ui/app/MainHeader.js'), 'utf8')
        .replace(/^import .*;\n/, '').replace('export class MainHeader', 'class MainHeader');
    vm.runInNewContext(source, {
        LitElement, html() {}, css() {}, console: quiet, window: { api }, clearTimeout,
        customElements: { define: (_name, constructor) => { Header = constructor; } },
    });
    const header = new Header(); header.connectedCallback();
    const headerWindow = {
        currentHeaderState: 'main',
        isDestroyed: () => false,
        webContents: { send: (channel, ...args) => ipc.emit(channel, {}, ...args) },
    };
    const windows = new Map([['header', headerWindow]]);
    const module = { exports: {} };
    const mocks = {
        electron: { globalShortcut: { register: (key, callback) => registered.set(key, callback), unregisterAll: () => registered.clear() }, screen: { getAllDisplays: () => [] } },
        './repositories': { getAllKeybinds: async () => stored || [], upsertKeybinds: async rows => writes.push(rows) },
        '../../bridge/internalBridge': new EventEmitter(),
        '../ask/askService': {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/shortcuts/shortcutsService.js'), 'utf8'), {
        module, exports: module.exports, console: quiet, process: { platform },
        require: name => {
            if (!(name in mocks)) throw new Error(`Unexpected require: ${name}`);
            return mocks[name];
        },
    });
    const service = module.exports; service.initialize(windows);
    return { api, ipc, header, headerWindow, windows, service, registered, requests, writes, controls };
}

test('registered shortcut follows the same Listen → Stop → Done cycle through real preload and header handlers', async () => {
    const h = harness(); await h.service.registerShortcuts();
    const shortcut = h.registered.get('Cmd+Shift+L');
    assert.equal(typeof shortcut, 'function');
    for (const next of ['inSession', 'afterSession', 'beforeSession', 'inSession']) {
        shortcut();
        await Promise.resolve();
        assert.equal(h.header.listenSessionStatus, next);
    }
    assert.deepEqual(h.requests, ['Listen', 'Stop', 'Done', 'Listen']);
    assert.equal(h.header.shortcuts.toggleListen, 'Cmd+Shift+L');
});

test('new binding migrates without replacing custom bindings and stays disabled when explicitly cleared', async () => {
    const custom = harness('linux', [{ action: 'nextStep', accelerator: 'Ctrl+Alt+Enter' }]);
    await custom.service.registerShortcuts();
    assert.equal(custom.registered.has('Ctrl+Shift+L'), true);
    assert.equal(custom.header.shortcuts.nextStep, 'Ctrl+Alt+Enter');
    assert.ok(custom.writes[0].some(row => row.action === 'toggleListen' && row.accelerator === 'Ctrl+Shift+L'));
    const disabled = harness('darwin', [{ action: 'toggleListen', accelerator: '' }]);
    await disabled.service.registerShortcuts();
    assert.equal(disabled.registered.has('Cmd+Shift+L'), false);
    assert.equal(disabled.header.shortcuts.toggleListen, '');
    const remapped = harness('darwin', [{ action: 'toggleListen', accelerator: 'Cmd+Alt+L' }]);
    await remapped.service.registerShortcuts();
    remapped.registered.get('Cmd+Alt+L')();
    assert.deepEqual(remapped.requests, ['Listen']);
});

test('repeated key presses wait for completion, failures reset, and disconnected headers stop listening', async () => {
    const h = harness(); await h.service.registerShortcuts();
    const shortcut = h.registered.get('Cmd+Shift+L');
    h.controls.complete = false;
    shortcut(); shortcut();
    assert.deepEqual(h.requests, ['Listen']);
    assert.equal(h.header.isTogglingSession, true);
    h.ipc.emit('listen:changeSessionResult', {}, { success: false });
    assert.equal(h.header.isTogglingSession, false);
    assert.equal(h.header.listenSessionStatus, 'beforeSession');
    h.controls.failInvoke = true;
    shortcut(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.header.isTogglingSession, false);
    h.header.disconnectedCallback();
    assert.equal(h.ipc.listenerCount('shortcut:listen'), 0);
    shortcut();
    assert.equal(h.requests.length, 2);
});

test('Listen shortcut stays off during API-key setup or when only Show/Hide is registered', async () => {
    const h = harness(); h.headerWindow.currentHeaderState = 'apikey';
    await h.service.registerShortcuts();
    assert.equal(h.registered.has('Cmd+Shift+L'), false);
    h.headerWindow.currentHeaderState = 'main';
    await h.service.registerShortcuts(true);
    assert.equal(h.registered.has('Cmd+Shift+L'), false);
    h.headerWindow.isDestroyed = () => true;
    await h.service.registerShortcuts();
    assert.doesNotThrow(() => h.registered.get('Cmd+Shift+L')());
    assert.deepEqual(h.requests, []);
});

function attachListenService(h, failure) {
    const notifications = [];
    const analysisErrors = [];
    h.ipc.on('listen:changeSessionResult', (_event, result) => notifications.push(result));
    h.windows.set('listen', { isDestroyed: () => false, webContents: { send() {} } });
    let callbacks;
    class Stt {
        setCallbacks(value) { callbacks = value; }
        flushMyCompletion() { return callbacks.onTranscriptionComplete('Me', 'Final synthetic response'); }
        flushTheirCompletion() {}
        async closeSessions() {}
        stopMacOSAudioCapture() {}
    }
    class Summary {
        setCallbacks() {}
        onSessionStopped() {}
        clearSession() {}
        broadcastState(state) { analysisErrors.push(state); }
    }
    const module = { exports: {} };
    const mocks = {
        electron: {}, './stt/sttService': Stt, './summary/summaryService': Summary,
        '../common/services/authService': { getCurrentUserId: () => 'owner' },
        '../common/repositories/session': { touch: async () => {}, end: async () => { if (failure === 'session') throw new Error('Session end failed'); } },
        './stt/repositories': { addTranscript: async () => { if (failure === 'transcript') throw new Error('Final transcript save failed'); } },
        '../../bridge/internalBridge': new EventEmitter(), '../../window/windowManager': { windowPool: h.windows },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/listen/listenService.js'), 'utf8'), {
        module, exports: module.exports, console: quiet, process: { platform: 'darwin' }, require: name => {
            if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
            return mocks[name];
        },
    });
    const listen = module.exports;
    listen.currentSessionId = 'session-a';
    h.controls.sessionHandler = async action => {
        try { await listen.handleListenRequest(action); return { success: true }; }
        catch (error) { return { success: false, error: error.message }; }
    };
    return { listen, notifications, analysisErrors };
}

test('header Stop reports failed final saves through real service/preload and stays at Done', async t => {
    for (const failure of ['transcript', 'session']) {
        await t.test(failure, async () => {
            const h = harness(); const { listen, notifications, analysisErrors } = attachListenService(h, failure);
            h.header.listenSessionStatus = 'inSession';
            await h.header._handleListenClick();
            assert.equal(listen.currentSessionId, null);
            assert.equal(h.header.listenSessionStatus, 'afterSession');
            assert.equal(h.header._getListenButtonText(h.header.listenSessionStatus), 'Done');
            assert.equal(h.header.isTogglingSession, false);
            assert.match(h.header.listenError, /failed|could not be saved/);
            assert.ok(notifications.length);
            assert.equal(notifications.every(result => result.success === false && result.status === 'afterSession'), true,
                'the closing finally and header request handler must never emit success after a failed save');
            assert.equal(analysisErrors.at(-1).phase, 'error');
            await h.header._handleListenClick();
            assert.deepEqual(h.requests, ['Stop', 'Done']);
            assert.equal(h.header.listenSessionStatus, 'beforeSession');
            assert.equal(h.header.listenError, '');
        });
    }
});

test('clearing a stopped review resets header through named IPC while hiding Insights preserves Done', async () => {
    const h = harness(); const { listen, notifications } = attachListenService(h);
    h.header.listenSessionStatus = 'afterSession';
    listen.setInsightsVisibility(false);
    listen.setInsightsVisibility(true);
    assert.equal(h.header.listenSessionStatus, 'afterSession', 'hide/reopen keeps the stopped review');
    listen.clearReviewedSession();
    assert.equal(h.header.listenSessionStatus, 'beforeSession');
    assert.equal(h.header._getListenButtonText(h.header.listenSessionStatus), 'Listen');
    assert.equal(h.header.insightsVisible, false);
    assert.deepEqual(notifications.map(result => [result.success, result.status]), [[true, 'beforeSession']]);
});


test('Insights shortcut opens and refreshes analysis through preload without changing Listen state', async () => {
    for (const [platform, accelerator] of [['darwin', 'Cmd+Shift+I'], ['win32', 'Ctrl+Shift+I']]) {
        const h = harness(platform); await h.service.registerShortcuts();
        const shortcut = h.registered.get(accelerator);
        assert.equal(typeof shortcut, 'function');
        shortcut(); await Promise.resolve();
        assert.equal(h.header.insightsVisible, true);
        shortcut(); await Promise.resolve();
        assert.equal(h.header.insightsVisible, true);
        assert.equal(h.controls.insightsToggles, 2);
        assert.equal(h.header.listenSessionStatus, 'beforeSession');
        assert.deepEqual(h.requests, []);
        h.controls.failInvoke = true;
        shortcut(); await new Promise(resolve => setImmediate(resolve));
        assert.equal(h.controls.insightsToggles, 2);
        h.header.disconnectedCallback();
        assert.equal(h.ipc.listenerCount('shortcut:insights'), 0);
        shortcut();
        assert.equal(h.controls.insightsToggles, 2);
    }
});

test('Insights binding backfills, respects remapping or disabling, and guards unavailable headers', async () => {
    const h = harness('darwin', [{ action: 'toggleListen', accelerator: 'Cmd+Alt+L' }]);
    await h.service.registerShortcuts();
    assert.ok(h.writes[0].some(row => row.action === 'toggleInsights' && row.accelerator === 'Cmd+Shift+I'));
    assert.equal(h.header.shortcuts.toggleListen, 'Cmd+Alt+L');
    h.headerWindow.isDestroyed = () => true;
    assert.doesNotThrow(() => h.registered.get('Cmd+Shift+I')());
    assert.equal(h.controls.insightsToggles, 0);
    for (const [accelerator, expected] of [['', false], ['Cmd+Alt+I', true]]) {
        const custom = harness('darwin', [{ action: 'toggleInsights', accelerator }]);
        await custom.service.registerShortcuts();
        assert.equal(custom.header.shortcuts.toggleInsights, accelerator);
        assert.equal(custom.registered.has('Cmd+Shift+I'), false);
        if (expected) {
            custom.registered.get(accelerator)();
            assert.equal(custom.controls.insightsToggles, 1);
        }
    }
    h.headerWindow.currentHeaderState = 'apikey';
    await h.service.registerShortcuts();
    assert.equal(h.registered.has('Cmd+Shift+I'), false);
    h.headerWindow.currentHeaderState = 'main';
    await h.service.registerShortcuts(true);
    assert.equal(h.registered.has('Cmd+Shift+I'), false);
});
