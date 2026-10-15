const sqliteRepository = require('./sqlite.repository');
const firebaseRepository = require('./firebase.repository');
const authService = require('../../common/services/authService');

function getBaseRepository(sessionId) {
    if (require('../../common/services/interviewContextService').isLocalSession(sessionId)) return sqliteRepository;
    const user = authService.getCurrentUser();
    if (user && user.isLoggedIn) {
        return firebaseRepository;
    }
    return sqliteRepository;
}

// The adapter layer that injects the UID
const askRepositoryAdapter = {
    addAiMessage: ({ sessionId, role, content, model }) => {
        const uid = authService.getCurrentUserId();
        return getBaseRepository(sessionId).addAiMessage({ uid, sessionId, role, content, model });
    },
    getAllAiMessagesBySessionId: (sessionId) => {
        // This function does not require a UID at the service level.
        return getBaseRepository(sessionId).getAllAiMessagesBySessionId(sessionId);
    }
};

module.exports = askRepositoryAdapter; 