// Offline defaults for the feed/cadence dependencies added to existing service harnesses.
const feed = {
    list: async () => ({ entries: [], hasMore: false }),
    save: async (_sessionId, _kind, entry) => ({ ...entry, id: entry.id || `snapshot-${Date.now()}` }),
};
module.exports = {
    '../../common/repositories/feed': feed,
    '../common/repositories/feed': feed,
    './insightScheduler': require('../src/features/listen/summary/insightScheduler'),
    './insightSettings': { get: () => ({ turns: 5, seconds: 30 }), set: value => value },
};
