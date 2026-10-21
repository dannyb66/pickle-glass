const express = require('express');
const auth = require('../../../src/features/common/services/authService');
const actions = require('../../../src/features/common/services/interviewActions');
const router = express.Router();

// These controls access local documents and the desktop microphone. Only the
// app's own website can use them; never trust X-User-ID for profile ownership.
router.use((req, res, next) => {
    const webOrigin = process.env.pickleglass_WEB_URL;
    const apiOrigin = process.env.pickleglass_API_URL;
    const allowedHosts = webOrigin && apiOrigin ? [new URL(apiOrigin).host, new URL(webOrigin).host] : [];
    const fromWebsite = webOrigin && (req.get('origin') === new URL(webOrigin).origin ||
        (!req.get('origin') && req.method === 'GET' && req.get('Sec-Fetch-Site') === 'same-origin' && req.get('host') === new URL(webOrigin).host));
    if (!allowedHosts.includes(req.get('host')) || !fromWebsite || req.get('X-Interview-Client') !== 'website') {
        return res.status(403).json({ error: 'Open Interview Context from the local Glass website.' });
    }
    next();
});

router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        const ownerId = auth.getCurrentUserId();
        res.json({ ownerId, data: await actions.run('list', undefined, ownerId) });
    } catch (error) { res.status(400).json({ error: error.message }); }
});
router.post('/:action', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!['save', 'select', 'preview', 'remove', 'fetch-jd', 'import', 'start', 'stop'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown interview action.' });
    try {
        const { ownerId, payload } = req.body;
        if (!ownerId || ownerId !== auth.getCurrentUserId()) return res.status(409).json({ error: 'User changed. Reload interview context before continuing.', ownerChanged: true });
        res.json({ ownerId, data: await actions.run(req.params.action, payload, ownerId) });
    } catch (error) {
        const ownerChanged = req.body?.ownerId !== auth.getCurrentUserId();
        res.status(ownerChanged ? 409 : 400).json({ error: error.message, ownerChanged });
    }
});
module.exports = router;
