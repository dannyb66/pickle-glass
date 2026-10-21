const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldOpenDevTools, shouldCheckForUpdates } = require('../src/startupOptions');

test('source launches stay quiet unless DevTools are explicitly requested', () => {
    assert.equal(shouldOpenDevTools(false, ['electron', '.']), false);
    assert.equal(shouldOpenDevTools(false, ['electron', '.', '--devtools']), true);
    assert.equal(shouldOpenDevTools(true, ['Glass', '--devtools']), false);
});

test('custom local builds never check upstream updates, including in production', () => {
    for (const env of [{}, { NODE_ENV: 'production' }, { NODE_ENV: 'development' }]) {
        assert.equal(shouldCheckForUpdates(true, true, env), false);
        assert.equal(shouldCheckForUpdates(false, false, env), false);
    }
    assert.equal(shouldCheckForUpdates(true, false, { NODE_ENV: 'production' }), true);
    assert.equal(shouldCheckForUpdates(true, false, { NODE_ENV: 'development' }), false);
});
