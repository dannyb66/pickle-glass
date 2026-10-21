const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
function harness() {
    const bridge = new EventEmitter();
    let bounds = { x: 100, y: 30, width: 425, height: 47 }, resizable = false;
    const header = { isDestroyed: () => false, getBounds: () => bounds, setBounds: value => { bounds = { ...value }; },
        isResizable: () => resizable, setResizable: value => { resizable = value; } };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/window/smoothMovementManager'), 'utf8'), {
        module, exports: module.exports, setTimeout, clearTimeout, require: () => ({ screen: {} }),
    });
    const windows = new Map([['header', header]]), movement = new module.exports(windows);
    movement.animationDuration = 20;
    const source = fs.readFileSync(require.resolve('../src/window/windowManager'), 'utf8');
    const controller = source.slice(source.indexOf('function setupWindowController('), source.indexOf('function changeAllWindowsVisibility('));
    vm.runInNewContext(controller + '\nsetupWindowController(windows, layout, movement);', {
        internalBridge: bridge, windows, movement, updateChildWindowLayouts() {},
        layout: { calculateHeaderResize: (_header, dimensions) => ({ ...bounds, ...dimensions }) },
    });
    return { bridge, movement, bounds: () => bounds, resizable: () => resizable };
}
test('setup-to-main resize interrupts the old animation and keeps the settings dots within 425px', async () => {
    const h = harness();
    h.bridge.emit('window:resizeHeaderWindow', { width: 320, height: 440 });
    assert.equal(h.movement.isAnimating, true);
    h.bridge.emit('window:resizeHeaderWindow', { width: 425, height: 47 });
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(h.bounds().width, 425); assert.equal(h.bounds().height, 47);
    assert.equal(h.resizable(), false, 'interrupted animations must restore the original fixed-size state');
});
test('another window animation cannot suppress a requested header resize', async () => {
    const h = harness(); h.movement.isAnimating = true;
    h.bridge.emit('window:resizeHeaderWindow', { width: 456, height: 370 });
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(h.bounds().width, 456); assert.equal(h.bounds().height, 370);
    assert.equal(h.resizable(), false);
});
