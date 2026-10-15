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

// The adapter layer that injects the UID
const sessionRepositoryAdapter = {
    setAuthService, // Expose the setter

    getById: (id) => getBaseRepository(id).getById(id),
    
    create: (type = 'ask') => {
        const uid = authService.getCurrentUserId();
        return getBaseRepository().create(uid, type);
    },
    
    getAllByUserId: () => {
        const uid = authService.getCurrentUserId();
        return getBaseRepository().getAllByUserId(uid);
    },

    updateTitle: (id, title) => getBaseRepository(id).updateTitle(id, title),
    
    deleteWithRelatedData: (id) => getBaseRepository(id).deleteWithRelatedData(id),

    end: (id) => getBaseRepository(id).end(id),

    updateType: (id, type) => getBaseRepository(id).updateType(id, type),

    touch: (id) => getBaseRepository(id).touch(id),

    getOrCreateActive: (requestedType = 'ask') => {
        const uid = authService.getCurrentUserId();
        const localId = interviewContext().activeLocalSession();
        if (localId) interviewContext().snapshot(localId);
        if (localId) return localId;
        return getBaseRepository().getOrCreateActive(uid, requestedType);
    },

    endAllActiveSessions: () => {
        const uid = authService.getCurrentUserId();
        sqliteRepository.endAllActiveSessions(uid);
        return getBaseRepository().endAllActiveSessions(uid);
    },
};

module.exports = sessionRepositoryAdapter; 