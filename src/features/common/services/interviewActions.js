// Shared interview operations for the desktop bridge and its local website.
const interview = require('./interviewContextService');
const sources = require('./interviewSourceService');
const auth = require('./authService');

async function run(action, payload, expectedOwner = auth.getCurrentUserId()) {
    const checkOwner = () => {
        if (!expectedOwner || expectedOwner !== auth.getCurrentUserId()) throw new Error('User changed. Reload interview context before continuing.');
    };
    checkOwner();
    let result;
    switch (action) {
        case 'list': {
            const activeId = interview.activeLocalSession();
            const packet = activeId ? interview.snapshot(activeId).packet : null;
            result = { ...interview.list(), active: packet ? { name: packet.name, revision: packet.revision } : null };
            break;
        }
        case 'save': result = interview.save(payload); break;
        case 'select': result = interview.select(payload); break;
        case 'preview': result = interview.preview(payload); break;
        case 'fetch-jd': result = await sources.fetchJobDescription(payload); break;
        case 'import': {
            if (!payload || typeof payload.name !== 'string' || typeof payload.base64 !== 'string' || payload.base64.length > Math.ceil(sources.MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)) throw new Error('Choose a document smaller than 2 MiB.');
            result = await sources.importDocument(payload.name, Buffer.from(payload.base64, 'base64'));
            break;
        }
        case 'remove': {
            result = interview.remove(payload);
            const listen = require('../../listen/listenService');
            if (result.invalidatedSessions.includes(listen.currentSessionId)) await listen.closeSession();
            break;
        }
        case 'start': {
            const listen = require('../../listen/listenService');
            const ask = require('../../ask/askService');
            const sessions = require('../repositories/session');
            if (!interview.selected()) throw new Error('Select a saved, reviewed interview profile first.');
            if (listen.currentSessionId) {
                const closed = await listen.closeSession();
                if (closed?.success === false) throw new Error(closed.error || 'Session could not be saved completely.');
            }
            checkOwner();
            listen.clearReviewedSession?.();
            await ask.closeAskWindow();
            checkOwner();
            await sessions.endAllActiveSessions();
            checkOwner();
            const sessionId = interview.ensureSession('listen', true);
            checkOwner();
            // Context activation must work for typed/screen questions even when
            // no speech provider is available. Listen remains an explicit action.
            result = { sessionId, snapshot: interview.snapshot(sessionId), recording: false };
            break;
        }
        case 'stop': {
            const listen = require('../../listen/listenService');
            const ask = require('../../ask/askService');
            if (listen.currentSessionId) {
                const closed = await listen.closeSession();
                if (closed?.success === false) throw new Error(closed.error || 'Session could not be saved completely.');
            }
            listen.clearReviewedSession?.();
            checkOwner();
            await ask.closeAskWindow();
            checkOwner();
            await require('../repositories/session').endAllActiveSessions();
            checkOwner();
            interview.select(null);
            result = true;
            break;
        }
        default: throw new Error('Unknown interview action.');
    }
    checkOwner();
    return result;
}
module.exports = { run };
