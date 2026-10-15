const SCHEMA = `CREATE TABLE IF NOT EXISTS interview_profiles (id TEXT PRIMARY KEY, uid TEXT NOT NULL, revision INTEGER NOT NULL, profile_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS interview_selection (uid TEXT PRIMARY KEY, profile_id TEXT);
CREATE TABLE IF NOT EXISTS interview_session_context (session_id TEXT PRIMARY KEY, uid TEXT NOT NULL, profile_id TEXT NOT NULL, snapshot_json TEXT, invalid INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS interview_profiles_owner ON interview_profiles(uid);`;
class InterviewRepository {
    constructor(db) { this.db = db; db.exec(SCHEMA); }
    list(uid) { return this.db.prepare('SELECT profile_json FROM interview_profiles WHERE uid=? ORDER BY updated_at DESC, id').all(uid).map(row => JSON.parse(row.profile_json)); }
    get(uid, id) { const row = this.db.prepare('SELECT profile_json FROM interview_profiles WHERE uid=? AND id=?').get(uid, id); return row ? JSON.parse(row.profile_json) : null; }
    save(uid, profile, expectedRevision) {
        return this.db.transaction(() => {
            const owner = this.db.prepare('SELECT uid FROM interview_profiles WHERE id=?').get(profile.id);
            if (owner && owner.uid !== uid) throw new Error('Interview profile not found.');
            const current = this.get(uid, profile.id);
            if (expectedRevision !== (current?.revision || 0)) throw new Error('This profile changed. Reload it before saving.');
            profile.revision = (current?.revision || 0) + 1;
            this.db.prepare('INSERT INTO interview_profiles VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,profile_json=excluded.profile_json,updated_at=excluded.updated_at WHERE uid=excluded.uid').run(profile.id, uid, profile.revision, JSON.stringify(profile), Date.now());
            return profile;
        })();
    }
    selected(uid) { return this.db.prepare('SELECT profile_id FROM interview_selection WHERE uid=?').get(uid)?.profile_id || null; }
    select(uid, id) { if (id && !this.get(uid, id)) throw new Error('Interview profile not found.'); this.db.prepare('INSERT INTO interview_selection VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET profile_id=excluded.profile_id').run(uid, id || null); }
    bind(uid, sessionId, profileId, snapshot) { this.db.prepare('INSERT INTO interview_session_context VALUES (?,?,?,?,0)').run(sessionId, uid, profileId, JSON.stringify(snapshot)); }
    anyBinding(sessionId) { return this.db.prepare('SELECT * FROM interview_session_context WHERE session_id=?').get(sessionId); }
    binding(uid, sessionId) { return this.db.prepare('SELECT * FROM interview_session_context WHERE uid=? AND session_id=?').get(uid, sessionId); }
    remove(uid, id) {
        return this.db.transaction(() => {
            const sessions = this.db.prepare('SELECT session_id FROM interview_session_context WHERE uid=? AND profile_id=?').all(uid, id).map(row => row.session_id);
            this.db.prepare('UPDATE interview_session_context SET snapshot_json=NULL, invalid=1 WHERE uid=? AND profile_id=?').run(uid, id);
            this.db.prepare('DELETE FROM interview_profiles WHERE uid=? AND id=?').run(uid, id);
            this.db.prepare('DELETE FROM interview_selection WHERE uid=? AND profile_id=?').run(uid, id);
            return sessions;
        })();
    }
}
module.exports = { InterviewRepository, SCHEMA };
