const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function harness(platform = 'darwin', stored = []) {
    const bridge = new EventEmitter();
    const registered = new Map();
    const windows = new Map([['header', {
        currentHeaderState: 'main', isDestroyed: () => false,
        webContents: { send() {} },
    }]]);
    const module = { exports: {} };
    const mocks = {
        electron: {
            globalShortcut: { register: (key, callback) => registered.set(key, callback), unregisterAll: () => registered.clear() },
            screen: { getAllDisplays: () => [] },
        },
        './repositories': { getAllKeybinds: async () => stored, upsertKeybinds: async () => {} },
        '../../bridge/internalBridge': bridge,
        '../ask/askService': {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/shortcuts/shortcutsService.js'), 'utf8'), {
        module, exports: module.exports, process: { platform }, console: { log() {}, error() {} },
        require(name) { assert.ok(name in mocks, name); return mocks[name]; },
    });
    module.exports.initialize(windows);

    function addPanel(name) {
        const ipc = new EventEmitter();
        let api;
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8'), {
            process: { platform }, require(name) {
                assert.equal(name, 'electron');
                return { contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: ipc };
            },
        });
        const state = { visible: true, focused: false, destroyed: false, minimized: false };
        const panel = {
            isVisible: () => state.visible, isFocused: () => state.focused,
            isDestroyed: () => state.destroyed, isMinimized: () => state.minimized,
            webContents: { send: (channel, ...args) => ipc.emit(channel, {}, ...args) },
        };
        windows.set(name, panel);
        return { api, ipc, state };
    }
    return { service: module.exports, bridge, registered, windows, addPanel };
}

test('registered scroll shortcuts reach the focused Chat or Insights through the real preload channels', async () => {
    for (const [platform, modifier] of [['darwin', 'Cmd'], ['win32', 'Ctrl']]) {
        const h = harness(platform);
        await h.service.registerShortcuts();
        // Feature windows are created after the header registers its shortcuts.
        const ask = h.addPanel('ask'), insights = h.addPanel('listen');
        const received = [];
        ask.api.askView.onScrollResponseUp(() => received.push('chat-up'));
        ask.api.askView.onScrollResponseDown(() => received.push('chat-down'));
        insights.api.insights.onScrollUp(() => received.push('insights-up'));
        insights.api.insights.onScrollDown(() => received.push('insights-down'));
        ask.state.focused = true;
        h.registered.get(`${modifier}+Shift+Up`)();
        h.registered.get(`${modifier}+Shift+Down`)();
        ask.state.focused = false; insights.state.focused = true;
        h.registered.get(`${modifier}+Shift+Up`)();
        h.registered.get(`${modifier}+Shift+Down`)();
        assert.deepEqual(received, ['chat-up', 'chat-down', 'insights-up', 'insights-down']);
    }
});

test('scroll falls back to the latest activated visible panel and skips hidden, minimized or destroyed panels', async () => {
    const h = harness(); await h.service.registerShortcuts();
    const ask = h.addPanel('ask'), insights = h.addPanel('listen');
    const received = [];
    ask.api.askView.onScrollResponseDown(() => received.push('chat'));
    insights.api.insights.onScrollDown(() => received.push('insights'));
    const scroll = h.registered.get('Cmd+Shift+Down');
    scroll(); // Deterministic fallback before either window has been activated.
    h.bridge.emit('window:featurePanelActivated', { name: 'ask' });
    h.bridge.emit('window:featurePanelActivated', { name: 'listen' });
    h.bridge.emit('window:featurePanelActivated', { name: 'settings' });
    scroll();
    ask.state.focused = true;
    scroll(); // A focused panel wins over a more recently shown panel.
    ask.state.focused = false; insights.state.visible = false;
    scroll();
    insights.state.visible = true; insights.state.minimized = true;
    scroll();
    insights.state.minimized = false; insights.state.destroyed = true;
    scroll();
    ask.state.visible = false;
    assert.doesNotThrow(scroll);
    assert.deepEqual(received, ['chat', 'insights', 'chat', 'chat', 'chat', 'chat']);
    h.windows.delete('listen'); h.windows.delete('ask');
    assert.doesNotThrow(scroll);
});

test('custom scroll bindings remain remapped or disabled', async () => {
    const h = harness('darwin', [{ action: 'scrollUp', accelerator: '' }, { action: 'scrollDown', accelerator: 'Cmd+Alt+J' }]);
    await h.service.registerShortcuts();
    const insights = h.addPanel('listen'); let scrolled = 0;
    insights.api.insights.onScrollDown(() => scrolled++);
    assert.equal(h.registered.has('Cmd+Shift+Up'), false);
    assert.equal(h.registered.has('Cmd+Shift+Down'), false);
    h.registered.get('Cmd+Alt+J')();
    assert.equal(scrolled, 1);
});

test('named scroll listener removal detaches only its callback in both panels', async () => {
    const h = harness(); await h.service.registerShortcuts();
    for (const name of ['ask', 'listen']) {
        const panel = h.addPanel(name); panel.state.focused = true;
        const api = name === 'ask' ? panel.api.askView : panel.api.insights;
        const onUp = name === 'ask' ? 'onScrollResponseUp' : 'onScrollUp';
        const removeUp = name === 'ask' ? 'removeOnScrollResponseUp' : 'removeOnScrollUp';
        const onDown = name === 'ask' ? 'onScrollResponseDown' : 'onScrollDown';
        const removeDown = name === 'ask' ? 'removeOnScrollResponseDown' : 'removeOnScrollDown';
        let removed = 0, retained = 0;
        const first = () => removed++, second = () => retained++;
        api[onUp](first); api[onUp](second); api[onDown](first); api[onDown](second);
        api[removeUp](first); api[removeDown](first);
        h.registered.get('Cmd+Shift+Up')(); h.registered.get('Cmd+Shift+Down')();
        assert.equal(removed, 0); assert.equal(retained, 2);
        api[removeUp](second); api[removeDown](second);
        assert.equal(panel.ipc.listenerCount('scroll-response-up'), 0);
        assert.equal(panel.ipc.listenerCount('scroll-response-down'), 0);
        h.windows.delete(name);
    }
});
