const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { InterviewRepository } = require('../repositories/interviewContext/sqlite.repository');
const { LIMITS, hash, buildPacket, messagesForSnapshot } = require('../prompts/interviewContext');
function field(value, name, limit = 200, required = false) {
    if (typeof value !== 'string') value = '';
    value = value.trim();
    if ((required && !value) || value.length > limit) throw new Error(`${name} ${!value ? 'is required' : `exceeds ${limit} characters`}.`);
    return value;
}
function validate(input) {
    if (!input || typeof input !== 'object') throw new Error('Interview profile is required.');
    if (input.id && (typeof input.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input.id))) throw new Error('Invalid profile identifier.');
    const resumeText = field(input.resume?.text, 'Resume text', LIMITS.input, true);
    if (input.resume?.confirmed !== true || input.resume?.confirmedHash !== hash(resumeText)) throw new Error('Review the chosen resume and confirm this exact text before saving.');
    const references = input.references || [];
    if (!Array.isArray(references) || references.length > LIMITS.references) throw new Error(`Use at most ${LIMITS.references} references.`);
    return { id: input.id || randomUUID(), revision: Number.isInteger(input.revision) ? input.revision : 0,
        name: field(input.name, 'Profile name', 120, true), company: field(input.company, 'Company'), role: field(input.role, 'Role', 200, true),
        round: 'system_design', level: field(input.level, 'Level', 120), minutes: Math.max(10, Math.min(180, Number(input.minutes) || 45)),
        resume: { name: field(input.resume.name, 'Resume name', 180, true), text: resumeText, confirmed: true, confirmedHash: hash(resumeText) },
        jd: { text: field(input.jd?.text, 'Job description', LIMITS.input, true), url: field(input.jd?.url, 'JD URL', 2000) },
        references: references.map(ref => ({ name: field(ref.name, 'Reference name', 180, true), text: field(ref.text, 'Reference text', LIMITS.input, true) })) };
}
class InterviewContextService extends EventEmitter {
    constructor({ getDb, getUid } = {}) {
        super(); this.getDb = getDb || (() => require('./sqliteClient').getDb());
        this.getUid = getUid || (() => require('./authService').getCurrentUserId());
        this.cachedDb = null; this.repository = null;
    }
    repo() { const db = this.getDb(); if (db !== this.cachedDb) { this.repository = new InterviewRepository(db); this.cachedDb = db; } return this.repository; }
    uid() { const uid = this.getUid(); if (!uid) throw new Error('User session is not ready.'); return uid; }
    list() { const uid = this.uid(); return { profiles: this.repo().list(uid), selectedId: this.repo().selected(uid) }; }
    save(input) { const profile = validate(input); return this.repo().save(this.uid(), profile, profile.revision); }
    select(id) { this.repo().select(this.uid(), id); return this.list(); }
    preview(id) { const profile = this.repo().get(this.uid(), id); if (!profile) throw new Error('Interview profile not found.'); return buildPacket(profile); }
    selected() { const id = this.repo().selected(this.uid()); return id ? this.repo().get(this.uid(), id) : null; }
    pin(sessionId, profile = this.selected()) {
        const existing = this.repo().binding(this.uid(), sessionId);
        if (existing) return this.snapshot(sessionId);
        if (!profile) return null;
        const snapshot = buildPacket(profile);
        this.repo().bind(this.uid(), sessionId, profile.id, snapshot);
        return snapshot;
    }
    snapshot(sessionId) {
        const binding = this.repo().anyBinding(sessionId);
        if (binding && binding.uid !== this.uid()) throw new Error('Interview session belongs to a different user. Start a new session.');
        if (!binding) return null;
        if (binding.invalid || !binding.snapshot_json) throw new Error('Interview context was deleted. Start a new session with a reviewed profile.');
        return JSON.parse(binding.snapshot_json);
    }
    context(sessionId) { return messagesForSnapshot(this.snapshot(sessionId)); }
    remove(id) { const sessions = this.repo().remove(this.uid(), id); this.emit('invalidated', sessions); return { success: true, invalidatedSessions: sessions, notice: 'Profile text and snapshots deleted locally. Previous answers and bytes already sent to a provider are not retracted.' }; }
    isInterviewSession(sessionId) { return !!sessionId && !!this.repo().anyBinding(sessionId); }
    isLocalSession(sessionId) {
        if (!sessionId) return false;
        const binding = this.repo().anyBinding(sessionId);
        if (binding && binding.uid !== this.uid()) throw new Error('Interview session belongs to a different user.');
        return !!binding;
    }
    activeLocalSession() {
        const uid = this.uid(); this.repo();
        return this.getDb().prepare('SELECT s.id FROM sessions s JOIN interview_session_context c ON c.session_id=s.id WHERE c.uid=? AND s.uid=? AND s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1').get(uid, uid)?.id || null;
    }
    ensureSession(type, forceNew = false) {
        const active = !forceNew && this.activeLocalSession();
        if (active) { this.snapshot(active); return active; }
        const profile = this.selected(); if (!profile) return null;
        const sessionRepo = require('../repositories/session/sqlite.repository');
        const sessionId = sessionRepo.create(this.uid(), type); this.pin(sessionId, profile); return sessionId;
    }
}
const service = new InterviewContextService();
module.exports = service;
module.exports.InterviewContextService = InterviewContextService;
module.exports.validate = validate;
