const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness({ signedIn = true, local = [], cloud = [], bound = [], localList, cloudList, localGet, cloudGet } = {}) {
    let owner = signedIn ? 'owner-a' : 'default_user';
    const calls = [];
    const repository = (name, rows, list, get) => ({
        getAllByUserId(uid) { calls.push([name, 'list', uid]); return list ? list(uid) : rows; },
        getById(id) { calls.push([name, 'get', id]); return get ? get(id) : rows.find(row => row.id === id); },
        deleteWithRelatedData(id) { calls.push([name, 'delete', id]); return { success: true }; },
    });
    const sqlite = repository('local', local, localList, localGet);
    const firebase = repository('cloud', cloud, cloudList, cloudGet);
    const module = { exports: {} };
    const mocks = {
        './sqlite.repository': sqlite,
        './firebase.repository': firebase,
        '../../services/interviewContextService': {
            isLocalSession: id => bound.includes(id),
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/common/repositories/session/index.js'), 'utf8'), {
        module, exports: module.exports, require(name) { if (name in mocks) return mocks[name]; throw new Error(`Unexpected import: ${name}`); },
    });
    const adapter = module.exports;
    adapter.setAuthService({ getCurrentUserId: () => owner, getCurrentUser: () => ({ uid: owner, isLoggedIn: signedIn }) });
    return { adapter, calls, changeOwner: value => { owner = value; } };
}
const session = (id, started_at, uid = 'owner-a') => ({ id, uid, started_at, ended_at: started_at + 1 });

test('signed-in Activity merges bound local interview sessions with cloud history in date order', async () => {
    const local = [session('interview', 30), session('local-generic', 40), session('anonymous', 50, 'default_user'), session('foreign', 60, 'owner-b')];
    const cloud = [session('cloud', 20), session('old-cloud', 10), session('foreign-cloud', 70, 'owner-b')];
    const { adapter, calls } = harness({ local, cloud, bound: ['interview', 'anonymous', 'foreign'] });
    const result = await adapter.getAllByUserId();
    assert.deepEqual(Array.from(result, row => row.id), ['interview', 'cloud', 'old-cloud']);
    assert.deepEqual(calls, [['cloud', 'list', 'owner-a'], ['local', 'list', 'owner-a']]);
    assert.equal((await adapter.getById('interview')).id, 'interview');
    assert.deepEqual(calls.at(-1), ['local', 'get', 'interview']);
    assert.equal((await adapter.getById('cloud')).id, 'cloud');
    assert.deepEqual(calls.at(-1), ['cloud', 'get', 'cloud']);
    await adapter.deleteWithRelatedData('interview');
    assert.deepEqual(calls.at(-1), ['local', 'delete', 'interview']);
});

test('history deduplicates IDs and prefers the local interview record', async () => {
    const { adapter } = harness({ local: [session('same', 20)], cloud: [session('same', 10)], bound: ['same'] });
    const result = await adapter.getAllByUserId();
    assert.equal(result.length, 1);
    assert.equal(result[0].started_at, 20);
});

test('anonymous Activity reads only anonymous local history and never accesses Firebase', async () => {
    const { adapter, calls } = harness({ signedIn: false, local: [session('anonymous', 10, 'default_user'), session('signed-in', 20)] });
    assert.deepEqual(Array.from(await adapter.getAllByUserId(), row => row.id), ['anonymous']);
    assert.deepEqual(calls, [['local', 'list', 'default_user']]);
});

test('local detail and delete operations reject another owner even for an unbound ID', async () => {
    const { adapter, calls } = harness({ signedIn: false, local: [session('foreign', 10, 'owner-b')] });
    await assert.rejects(adapter.getById('foreign'), /different user/);
    await assert.rejects(adapter.deleteWithRelatedData('foreign'), /different user/);
    assert.equal(calls.some(call => call[1] === 'delete'), false);
});

test('cloud detail and delete reject rows belonging to an unrelated owner', async () => {
    const { adapter, calls } = harness({ cloud: [session('foreign', 10, 'owner-b')] });
    await assert.rejects(adapter.getById('foreign'), /different user/);
    await assert.rejects(adapter.deleteWithRelatedData('foreign'), /different user/);
    assert.equal(calls.some(call => call[1] === 'delete'), false);
});

test('cloud member access remains readable while only its owner can delete', async () => {
    const shared = { ...session('shared', 10, 'owner-b'), members: ['owner-a', 'owner-b'] };
    const { adapter, calls } = harness({ cloud: [shared] });
    assert.equal((await adapter.getById('shared')).id, 'shared');
    assert.deepEqual(Array.from(await adapter.getAllByUserId(), row => row.id), ['shared']);
    await assert.rejects(adapter.deleteWithRelatedData('shared'), /Only the session owner/);
    assert.equal(calls.some(call => call[1] === 'delete'), false);
});

test('switching owners during cloud history retrieval cannot expose the previous list', async () => {
    const pending = deferred();
    const { adapter, calls, changeOwner } = harness({ cloudList: () => pending.promise });
    const request = adapter.getAllByUserId();
    changeOwner('owner-b');
    pending.resolve([session('old-owner-data', 10)]);
    await assert.rejects(request, /User changed/);
    assert.equal(calls.some(call => call[0] === 'local'), false);
});

test('switching owners during local interview merge cannot return the previous list', async () => {
    const pending = deferred();
    const { adapter, changeOwner } = harness({ cloud: [session('cloud', 10)], localList: () => pending.promise, bound: ['interview'] });
    const request = adapter.getAllByUserId();
    await new Promise(resolve => setImmediate(resolve));
    changeOwner('owner-b');
    pending.resolve([session('interview', 20)]);
    await assert.rejects(request, /User changed/);
});

test('switching owners while detail lookup is pending rejects reads and prevents deletes', async () => {
    for (const action of ['getById', 'deleteWithRelatedData']) {
        const pending = deferred();
        const { adapter, calls, changeOwner } = harness({ cloudGet: () => pending.promise });
        const request = adapter[action]('cloud');
        changeOwner('owner-b');
        pending.resolve(session('cloud', 10));
        await assert.rejects(request, /User changed/);
        assert.equal(calls.some(call => call[1] === 'delete'), false);
    }
});


test('activity details reject account changes while transcript and answer reads are pending', async () => {
    const { EventEmitter } = require('node:events');
    const bridge = new EventEmitter();
    const pending = deferred(); let owner = 'owner-a';
    const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    const setup = source.slice(source.indexOf('function setupWebDataHandlers()'), source.indexOf('async function handleCustomUrl('));
    const mocks = {
        './features/common/repositories/session': { getById: async () => ({ id: 'private', uid: 'owner-a' }) },
        './features/listen/stt/repositories': { getAllTranscriptsBySessionId: () => pending.promise },
        './features/listen/summary/repositories': { getSummaryBySessionId: async () => null },
        './features/ask/repositories': { getAllAiMessagesBySessionId: async () => [] },
        './features/common/repositories/user': {}, './features/common/repositories/preset': {},
    };
    vm.runInNewContext(setup + '\nsetupWebDataHandlers();', { eventBridge: bridge,
        authService: { getCurrentUserId: () => owner }, console: { error() {} },
        require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; } });
    const response = new Promise(resolve => bridge.once('details-result', resolve));
    bridge.emit('web-data-request', 'get-session-details', 'details-result', 'private');
    await new Promise(resolve => setImmediate(resolve));
    owner = 'owner-b'; pending.resolve([{ text: 'Private old account transcript' }]);
    const result = await response;
    assert.equal(result.success, false);
    assert.match(result.error, /User changed/);
    assert.equal(result.data, undefined);
});
