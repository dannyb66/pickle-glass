const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

function harness({ mic = 'granted', screen = 'denied', captureFails = false, platform = 'darwin', statusError = false, relaunchFails = false } = {}) {
    const calls = [], scheduled = [];
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/features/common/services/permissionService'), 'utf8'), {
        module, exports: module.exports, console: { log() {}, error() {} },
        process: { platform, argv: ['Glass', '--remote-debugging-port=9238', '--inspect-brk=9229', '--devtools', '--user-flag'] },
        setImmediate: fn => scheduled.push(fn),
        require(name) {
            if (name === 'electron') return {
                app: { relaunch: options => { if (relaunchFails) throw Error('Relaunch failed'); calls.push(['relaunch', options]); }, quit: () => calls.push(['quit']) },
                systemPreferences: { getMediaAccessStatus: type => { if (statusError) throw Error('Permission service unavailable'); return type === 'microphone' ? mic : screen; }, askForMediaAccess: async () => { calls.push(['ask-mic']); return true; } },
                shell: { openExternal: async url => calls.push(['settings', url]) },
                desktopCapturer: { getSources: async () => { calls.push(['capture-request']); if (captureFails) throw Error('Screen denied'); return []; } },
            };
            if (name === '../repositories/permission') return {};
            if (name === './authService') return { getCurrentUserId: () => 'default_user' };
            throw Error(name);
        },
    });
    return { service: module.exports, calls, scheduled };
}

test('screen denial remains denied even when microphone and keychain are granted', async () => {
    const h = harness();
    const permissions = await h.service.checkSystemPermissions();
    assert.equal(permissions.microphone, 'granted');
    assert.equal(permissions.screen, 'denied');
    assert.equal(permissions.keychain, 'granted');
    assert.equal(permissions.needsSetup, true);
    assert.equal((await harness({ screen: 'granted' }).service.checkSystemPermissions()).needsSetup, false);
});

test('screen recovery actually opens System Settings before requesting registration', async () => {
    const h = harness({ captureFails: true });
    assert.equal((await h.service.openSystemPreferences('screen-recording')).success, true);
    assert.deepEqual(h.calls, [['settings', 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'], ['capture-request']]);
    assert.equal((await h.service.openSystemPreferences('untrusted-pane')).success, false);
    assert.equal(h.calls.length, 2);
});

test('previously denied microphone access opens its settings instead of repeatedly requesting a suppressed dialog', async () => {
    const h = harness({ mic: 'denied' });
    const result = await h.service.requestMicrophonePermission();
    assert.equal(result.status, 'denied');
    assert.equal(result.settingsOpened, true);
    assert.deepEqual(h.calls, [['settings', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone']]);
    const fresh = harness({ mic: 'not-determined' });
    assert.equal((await fresh.service.requestMicrophonePermission()).status, 'granted');
    assert.deepEqual(fresh.calls, [['ask-mic']]);
});

test('restart schedules a graceful quit and drops developer tooling arguments', () => {
    const h = harness();
    assert.equal(h.service.restartApplication().success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['relaunch', { args: ['--user-flag'] }]]);
    assert.equal(h.service.restartApplication().success, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.scheduled.length, 1);
    h.scheduled[0]();
    assert.deepEqual(h.calls[1], ['quit']);
});


test('permission check failures are returned as explicit errors for the setup UI', async () => {
    const permissions = await harness({ statusError: true }).service.checkSystemPermissions();
    assert.equal(permissions.success, false);
    assert.equal(permissions.needsSetup, true);
    assert.match(permissions.error, /Permission service unavailable/);
});

test('failed relaunch can be retried without scheduling a quit', () => {
    const h = harness({ relaunchFails: true });
    assert.throws(() => h.service.restartApplication(), /Relaunch failed/);
    assert.throws(() => h.service.restartApplication(), /Relaunch failed/);
    assert.equal(h.service._restartRequested, false);
    assert.equal(h.scheduled.length, 0);
});
