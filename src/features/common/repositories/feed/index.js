const { randomUUID } = require('node:crypto');
const sqlite = require('../../services/sqliteClient');
const auth = require('../../services/authService');
const { getFirestoreInstance } = require('../../services/firebaseClient');
const { createEncryptedConverter } = require('../firestoreConverter');
const { collection, doc, setDoc, getDocs, query, orderBy, limit, startAfter, documentId } = require('firebase/firestore');
const converter = createEncryptedConverter(['data_json']);
function cloud(sessionId) {
    return !require('../../services/interviewContextService').isLocalSession(sessionId) && auth.getCurrentUser()?.isLoggedIn;
}
function checkOwner(uid) {
    if (auth.getCurrentUserId() !== uid) throw new Error('User changed. Reload history before continuing.');
}
function col(sessionId, kind) {
    return collection(getFirestoreInstance(), `sessions/${sessionId}/${kind}_feed`).withConverter(converter);
}
async function save(sessionId, kind, entry) {
    if (!sessionId || !['ask', 'insights'].includes(kind)) throw new Error('Invalid feed');
    const uid = auth.getCurrentUserId();
    const value = { ...entry, id: entry.id || randomUUID(), timestamp: entry.timestamp || Date.now() };
    const data_json = JSON.stringify(value);
    if (cloud(sessionId)) {
        await setDoc(doc(col(sessionId, kind), value.id), { uid, timestamp: value.timestamp, data_json });
    } else {
        sqlite.getDb().prepare(`INSERT INTO feed_entries (id, session_id, kind, timestamp, data_json) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json`).run(value.id, sessionId, kind, value.timestamp, data_json);
    }
    checkOwner(uid);
    return value;
}
async function list(sessionId, kind, before = null) {
    if (!sessionId || !['ask','insights'].includes(kind)) throw new Error('Invalid feed');
    const uid = auth.getCurrentUserId();
    if (before && (!Number.isFinite(before.timestamp) || typeof before.id !== 'string')) throw new Error('Invalid history cursor');
    let rows;
    if (cloud(sessionId)) {
        const constraints = [orderBy('timestamp', 'desc'), orderBy(documentId(), 'desc')];
        if (before) constraints.push(startAfter(before.timestamp, before.id));
        constraints.push(limit(21));
        rows = (await getDocs(query(col(sessionId, kind), ...constraints))).docs.map(d => d.data());
    } else {
        rows = before
            ? sqlite.getDb().prepare(`SELECT data_json FROM feed_entries WHERE session_id=? AND kind=? AND
                (timestamp < ? OR (timestamp = ? AND id < ?)) ORDER BY timestamp DESC, id DESC LIMIT 21`).all(sessionId, kind, before.timestamp, before.timestamp, before.id)
            : sqlite.getDb().prepare('SELECT data_json FROM feed_entries WHERE session_id=? AND kind=? ORDER BY timestamp DESC, id DESC LIMIT 21').all(sessionId, kind);
    }
    checkOwner(uid);
    const hasMore = rows.length > 20;
    const entries = rows.slice(0,20).map(r => JSON.parse(r.data_json)).reverse();
    return { entries, hasMore, cursor: entries.length ? { timestamp: entries[0].timestamp, id: entries[0].id } : null };
}
module.exports = { save, list };
