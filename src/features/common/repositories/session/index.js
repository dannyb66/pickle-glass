const sqliteRepository = require('./sqlite.repository');
const firebaseRepository = require('./firebase.repository');

let authService = null;

function setAuthService(service) {
    authService = service;
}

const interviewContext = () => require('../../services/interviewContextService');
function getBaseRepository(sessionId) {
    if (sessionId && interviewContext().isLocalSession(sessionId)) return sqliteRepository;
    if (!authService) {
        // Fallback or error if authService is not set, to prevent crashes.
        // During initial load, it might not be set, so we default to sqlite.
        return sqliteRepository;
    }
    const user = authService.getCurrentUser();
    if (user && user.isLoggedIn) {
        return firebaseRepository;
    }
    return sqliteRepository;
}

function currentOwner() {
    const uid = authService?.getCurrentUserId();
    if (!uid) throw new Error('User session is not ready.');
    return uid;
}

function checkOwner(uid) {
    if (currentOwner() !== uid) throw new Error('User changed. Reload activity before continuing.');
}

function canRead(session, uid, repository) {
    return session.uid === uid || (repository === firebaseRepository && Array.isArray(session.members) && session.members.includes(uid));
}

async function getOwnedSession(id, uid, repository) {
    const session = await repository.getById(id);
    checkOwner(uid);
    if (session && !canRead(session, uid, repository)) throw new Error('Session belongs to a different user.');
    return session;
}

// The adapter layer that injects the UID
const sessionRepositoryAdapter = {
    setAuthService, // Expose the setter

    getById: (id) => {
        const uid = currentOwner();
        return getOwnedSession(id, uid, getBaseRepository(id));
    },
    
    create: (type = 'ask') => {
        const uid = authService.getCurrentUserId();
        return getBaseRepository().create(uid, type);
    },
    
    getAllByUserId: async () => {
        const uid = currentOwner();
        const repository = getBaseRepository();
        const sessions = await repository.getAllByUserId(uid);
        checkOwner(uid);
        const visible = sessions.filter(session => canRead(session, uid, repository));
        if (repository === firebaseRepository) {
            const localSessions = await sqliteRepository.getAllByUserId(uid);
            checkOwner(uid);
            // Interview source packets stay local, including for signed-in users.
            // Anonymous history and unrelated local rows are never merged.
            visible.push(...localSessions.filter(session => session.uid === uid && interviewContext().isLocalSession(session.id)));
        }
        checkOwner(uid);
        return [...new Map(visible.map(session => [session.id, session])).values()]
            .sort((a, b) => (Number(b.started_at) || 0) - (Number(a.started_at) || 0) || String(a.id).localeCompare(String(b.id)));
    },

    updateTitle: (id, title) => getBaseRepository(id).updateTitle(id, title),
    
    deleteWithRelatedData: async (id) => {
        const uid = currentOwner();
        const repository = getBaseRepository(id);
        const session = await getOwnedSession(id, uid, repository);
        if (!session) throw new Error('Session not found.');
        if (session.uid !== uid) throw new Error('Only the session owner can delete this activity.');
        checkOwner(uid);
        const result = await repository.deleteWithRelatedData(id);
        checkOwner(uid);
        return result;
    },

    end: (id) => getBaseRepository(id).end(id),

    updateType: (id, type) => getBaseRepository(id).updateType(id, type),

    touch: (id) => getBaseRepository(id).touch(id),

    getOrCreateActive: async (requestedType = 'ask') => {
        const uid = currentOwner();
        const localId = interviewContext().activeLocalSession();
        if (localId) interviewContext().snapshot(localId);
        if (localId) return localId;
        const repository = getBaseRepository();
        if (interviewContext().selected()) {
            // Selecting a profile cannot change an ongoing generic conversation.
            // Only a fresh session receives the selected, immutable source packet.
            const sessions = await repository.getAllByUserId(uid);
            checkOwner(uid);
            // Another Ask/Listen request may have pinned a session during the read.
            const activeInterview = interviewContext().activeLocalSession();
            if (activeInterview) {
                interviewContext().snapshot(activeInterview);
                return activeInterview;
            }
            const hasActiveSession = sessions.some(session => session.uid === uid && session.ended_at == null);
            if (!hasActiveSession) {
                const interviewId = interviewContext().ensureSession(requestedType);
                if (interviewId) return interviewId;
            }
        }
        const sessionId = await repository.getOrCreateActive(uid, requestedType);
        checkOwner(uid);
        return sessionId;
    },

    endAllActiveSessions: () => {
        const uid = authService.getCurrentUserId();
        sqliteRepository.endAllActiveSessions(uid);
        return getBaseRepository().endAllActiveSessions(uid);
    },
};

module.exports = sessionRepositoryAdapter;
