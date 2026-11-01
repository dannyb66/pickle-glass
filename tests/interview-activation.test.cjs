const summaryDependencies = require('./summary-test-dependencies.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { hash } = require('../src/features/common/prompts/interviewContext');

function load(relative, mocks, extras = {}) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
        module, exports: module.exports, Buffer, TextDecoder, AbortController,
        process: { platform: 'linux' }, console: { log() {}, warn() {}, error() {} }, ...extras,
        require(name) { if (name in summaryDependencies) return summaryDependencies[name]; if (name in mocks) return mocks[name]; return require(name); },
    });
    return module.exports;
}
const fixture = label => ({ name: `${label} interview`, company: label, role: `${label} platform engineer`, revision: 0,
    resume: { name: `${label} resume`, text: `${label} candidate built a queue.`, confirmed: true, confirmedHash: hash(`${label} candidate built a queue.`) },
    jd: { text: `${label} requires tenant isolation.` }, references: [] });

function harness({ signedIn = false, cloudRows = [], cloudList } = {}) {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, uid TEXT, title TEXT, session_type TEXT, started_at INTEGER, updated_at INTEGER, ended_at INTEGER, sync_state TEXT); CREATE TABLE transcripts (session_id TEXT, speaker TEXT, text TEXT);');
    let owner = 'owner-a';
    const auth = { getCurrentUserId: () => owner, getCurrentUser: () => ({ uid: owner, isLoggedIn: signedIn }) };
    const sqlite = load('features/common/repositories/session/sqlite.repository.js', { '../../services/sqliteClient': { getDb: () => db } });
    const context = load('features/common/services/interviewContextService.js', {
        '../repositories/interviewContext/sqlite.repository': require('../src/features/common/repositories/interviewContext/sqlite.repository'),
        '../prompts/interviewContext': require('../src/features/common/prompts/interviewContext'),
        '../repositories/session/sqlite.repository': sqlite,
        './sqliteClient': { getDb: () => db }, './authService': auth,
    });
    const cloudCalls = [];
    const cloud = {
        endAllActiveSessions: async uid => { cloudRows.filter(row => row.uid === uid && row.ended_at == null).forEach(row => { row.ended_at = 123; }); },
        getAllByUserId: uid => cloudList ? cloudList(uid) : cloudRows,
        getOrCreateActive: async (uid, type) => {
            cloudCalls.push([uid, type]);
            return cloudRows.find(row => row.uid === uid && row.ended_at == null)?.id || 'cloud-new-session';
        },
    };
    const adapter = load('features/common/repositories/session/index.js', {
        './sqlite.repository': sqlite, './firebase.repository': cloud, '../../services/interviewContextService': context,
    });
    adapter.setAuthService(auth);
    const requests = { ask: [], summary: [] };
    const windows = { windowPool: new Map([['ask', { isDestroyed: () => false, webContents: { send() {} } }]]) };
    const model = { getCurrentModelInfo: async () => ({ apiKey: 'synthetic', provider: 'synthetic', model: 'synthetic' }) };
    const transcriptRepo = { getAllTranscriptsBySessionId: async id => db.prepare('SELECT * FROM transcripts WHERE session_id=?').all(id) };
    const ask = load('features/ask/askService.js', {
        electron: { BrowserWindow: {}, desktopCapturer: { getSources: async () => [] } }, sharp: null,
        '../../window/windowManager': windows, '../../bridge/internalBridge': new EventEmitter(),
        '../common/repositories/session': adapter, '../common/services/interviewContextService': context,
        '../common/services/authService': auth, '../common/services/modelStateService': model,
        '../common/prompts/promptBuilder': { getSystemPrompt: () => 'Trusted base policy' },
        '../listen/stt/repositories': transcriptRepo, './repositories': { addAiMessage: async () => {} },
        '../common/ai/factory': { createStreamingLLM: () => ({ streamChat: async messages => {
            requests.ask.push(messages);
            return { body: { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => {} }) } };
        } }) },
    });
    const Summary = load('features/listen/summary/summaryService.js', {
        '../../../window/windowManager': windows, '../../common/repositories/session': adapter,
        '../../common/services/interviewContextService': context, '../../common/services/authService': auth,
        '../../common/services/modelStateService': model, '../stt/repositories': transcriptRepo,
        '../../ask/repositories': { getAllAiMessagesBySessionId: async () => [] },
        '../../common/services/insightsScreenContext': { capture: async () => ({}), get: () => [], clear() {} },
        '../../common/prompts/promptBuilder.js': { getSystemPrompt: () => 'Trusted base policy' }, './repositories': { saveSummary: async () => {} },
        '../../common/ai/factory': { createLLM: () => ({ chat: async messages => {
            requests.summary.push(messages); return { content: '**Summary Overview**\n- Synthetic observation' };
        } }) },
    });
    return { db, sqlite, context, adapter, auth, ask, summary: new Summary(), requests, cloudCalls, changeOwner: uid => { owner = uid; } };
}
const native = { skip: !process.versions.electron };

test('saved selected profile reaches real Ask and Summary requests from a fresh normal session', native, async t => {
    const h = harness(); t.after(() => h.db.close());
    const profile = h.context.save(fixture('Orchid')); h.context.select(profile.id);
    const result = await h.ask.sendMessage('Which role and experience apply?');
    assert.equal(result.success, true, result.error);
    const id = h.ask.requestSessionId;
    const snapshot = h.context.snapshot(id);
    assert.ok(snapshot, 'normal Ask must create a pinned interview session');
    assert.equal(snapshot.packet.role, 'Orchid platform engineer');
    assert.match(snapshot.text, /Orchid candidate built a queue/);
    assert.match(snapshot.text, /Orchid requires tenant isolation/);
    assert.equal(h.requests.ask[0][1].content, h.context.context(id).context.content);
    assert.doesNotMatch(h.requests.ask[0][0].content, /Orchid candidate/);
    assert.equal(await h.adapter.getOrCreateActive('listen'), id, 'Listen must join the same pinned session');
    h.db.prepare('INSERT INTO transcripts VALUES (?,?,?)').run(id, 'Me', 'Design a queue');
    h.summary.setSessionId(id); await h.summary.requestAnalysis('entire');
    assert.equal(h.requests.summary[0][1].content, h.requests.ask[0][1].content);
});

test('profile edits and another selection cannot replace an active pinned session; fresh Listen uses the new selection', native, async t => {
    const h = harness(); t.after(() => h.db.close());
    const first = h.context.save(fixture('Orchid')); h.context.select(first.id);
    const id = await h.adapter.getOrCreateActive('listen');
    const original = h.context.snapshot(id).text;
    h.context.save({ ...first, role: 'Orchid principal engineer' });
    const other = h.context.save(fixture('Willow')); h.context.select(other.id);
    assert.equal(await h.adapter.getOrCreateActive('ask'), id);
    assert.equal(h.context.snapshot(id).text, original);
    h.sqlite.end(id);
    const fresh = await h.adapter.getOrCreateActive('listen');
    assert.notEqual(fresh, id); assert.equal(h.context.snapshot(fresh).packet.profileId, other.id);
    assert.equal((await h.ask.sendMessage('Use current interview')).success, true);
    assert.equal(h.ask.requestSessionId, fresh); assert.match(h.requests.ask[0][1].content, /Willow/);
    assert.doesNotMatch(h.requests.ask[0][1].content, /Orchid/);
});

test('selection during generic Listen preserves its Ask context and only applies after that session ends', native, async t => {
    const h = harness(); t.after(() => h.db.close());
    const generic = await h.adapter.getOrCreateActive('listen');
    const profile = h.context.save(fixture('Orchid')); h.context.select(profile.id);
    const result = await h.ask.sendMessage('Continue generic discussion');
    assert.equal(result.success, true, result.error);
    assert.equal(h.ask.requestSessionId, generic); assert.equal(h.context.snapshot(generic), null);
    assert.doesNotMatch(JSON.stringify(h.requests.ask[0]), /Orchid/);
    h.sqlite.end(generic);
    const fresh = await h.adapter.getOrCreateActive('listen');
    assert.notEqual(fresh, generic); assert.equal(h.context.snapshot(fresh).packet.profileId, profile.id);
    assert.equal(h.context.snapshot(generic), null, 'old generic history must never gain a profile retroactively');
    h.sqlite.end(fresh); h.context.select(null);
    const next = await h.adapter.getOrCreateActive('ask'); assert.equal(h.context.snapshot(next), null);
});

test('signed-in fresh interviews stay local while an existing cloud session stays generic', native, async t => {
    const cloudRows = [{ id: 'cloud-current', uid: 'owner-a', ended_at: null }];
    const h = harness({ signedIn: true, cloudRows }); t.after(() => h.db.close());
    const profile = h.context.save(fixture('Orchid')); h.context.select(profile.id);
    assert.equal(await h.adapter.getOrCreateActive('ask'), 'cloud-current');
    assert.equal(h.context.snapshot('cloud-current'), null);
    cloudRows[0].ended_at = 1;
    const fresh = await h.adapter.getOrCreateActive('listen');
    assert.ok(h.sqlite.getById(fresh)); assert.equal(h.context.snapshot(fresh).packet.profileId, profile.id);
    assert.equal(h.cloudCalls.length, 1, 'fresh interview creation must not create cloud data');
    h.changeOwner('owner-b');
    assert.equal(await h.adapter.getOrCreateActive('ask'), 'cloud-new-session');
    assert.equal(h.context.selected(), null); assert.throws(() => h.context.snapshot(fresh), /different user/);
});

test('owner switch during cloud lookup cannot attach a previous owner profile to a new session', native, async t => {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const h = harness({ signedIn: true, cloudList: () => pending }); t.after(() => h.db.close());
    const profile = h.context.save(fixture('Orchid')); h.context.select(profile.id);
    const request = h.adapter.getOrCreateActive('listen');
    h.changeOwner('owner-b'); resolve([]);
    await assert.rejects(request, /User changed/);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM interview_session_context').get().n, 0);
    assert.equal(h.cloudCalls.length, 0);
});

test('concurrent fresh Ask and Listen share one immutable profile snapshot', native, async t => {
    const h = harness(); t.after(() => h.db.close());
    const profile = h.context.save(fixture('Orchid')); h.context.select(profile.id);
    const [ask, listen] = await Promise.all([h.adapter.getOrCreateActive('ask'), h.adapter.getOrCreateActive('listen')]);
    assert.equal(ask, listen); assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM interview_session_context').get().n, 1);
});

test('explicit Start closes an older cloud conversation so the next fresh Listen keeps using selection', native, async t => {
    const cloudRows = [{ id: 'older-cloud-generic', uid: 'owner-a', ended_at: null }];
    const h = harness({ signedIn: true, cloudRows }); t.after(() => h.db.close());
    const profile = h.context.save(fixture('Orchid')); h.context.select(profile.id);
    const actions = load('features/common/services/interviewActions.js', {
        './interviewContextService': h.context, './authService': h.auth, './interviewSourceService': {},
        '../../listen/listenService': { currentSessionId: null, clearReviewedSession() {} },
        '../../ask/askService': { closeAskWindow: async () => {} },
        '../repositories/session': h.adapter,
    });
    const started = await actions.run('start');
    assert.equal(started.recording, false);
    assert.equal(cloudRows[0].ended_at, 123, 'explicit Start must close the generic cloud session');
    await h.adapter.end(started.sessionId); // Normal header Stop ends the pinned local session.
    const next = await h.adapter.getOrCreateActive('listen');
    assert.notEqual(next, started.sessionId);
    assert.equal(h.context.snapshot(next).packet.profileId, profile.id);
    assert.equal(h.cloudCalls.length, 0);
    await actions.run('stop');
    assert.equal(h.context.selected(), null);
    assert.equal(h.context.activeLocalSession(), null);
});
