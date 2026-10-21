const { desktopCapturer, systemPreferences } = require('electron');
const { createHash } = require('node:crypto');

// Screen snapshots stay in memory. Keep five chat screenshots plus the latest
// explicit analysis capture, rather than retaining an unbounded screen archive.
const sessions = new Map();
const owner = () => require('./authService').getCurrentUserId();
function remember(sessionId, uid, image, origin = 'chat') {
    if (!sessionId || uid !== owner() || !image?.success || typeof image.base64 !== 'string' || !image.base64 || image.base64.length > 4 * 1024 * 1024) return;
    const key = `${uid}:${sessionId}`;
    const hash = createHash('sha256').update(image.base64).digest('hex');
    let images = (sessions.get(key) || []).filter(item => item.hash !== hash && (origin !== 'manual' || item.origin !== 'manual'));
    images.push({ hash, base64: image.base64, mimeType: image.mimeType || 'image/jpeg', capturedAt: Date.now(), origin });
    const chat = images.filter(item => item.origin === 'chat').slice(-5);
    const manual = images.filter(item => item.origin === 'manual').slice(-1);
    sessions.delete(key);
    sessions.set(key, [...chat, ...manual].sort((a, b) => a.capturedAt - b.capturedAt));
    while (sessions.size > 3) sessions.delete(sessions.keys().next().value);
}
function get(sessionId, uid) {
    return uid === owner() ? [...(sessions.get(`${uid}:${sessionId}`) || [])] : [];
}
async function capture(sessionId, uid, current = () => true) {
    if (uid !== owner() || !current()) return { error: 'Session changed before screen capture.' };
    try {
        if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw new Error('Screen recording access is not granted.');
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1366, height: 768 } });
        if (!current() || uid !== owner()) return { error: 'Session changed during screen capture.' };
        const thumbnail = sources[0]?.thumbnail;
        if (!thumbnail || thumbnail.isEmpty()) throw new Error('No screen image was available.');
        remember(sessionId, uid, { success: true, base64: thumbnail.toJPEG(65).toString('base64') }, 'manual');
        return { captured: true };
    } catch (error) { return { error: error.message || 'Screen capture failed.' }; }
}
function clear(sessionId) {
    if (!sessionId) sessions.clear();
    else for (const key of sessions.keys()) if (key.endsWith(`:${sessionId}`)) sessions.delete(key);
}
module.exports = { remember, get, capture, clear };
