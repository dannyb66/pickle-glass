const Store = require('electron-store');
const store = new Store({ name: 'insight-cadence', defaults: { turns: 5, seconds: 30 } });
function get() { return { turns: store.get('turns', 5), seconds: store.get('seconds', 30) }; }
function set(value) {
    if (!value || !Number.isInteger(value.turns) || value.turns < 1 || value.turns > 100 ||
        !Number.isInteger(value.seconds) || value.seconds < 5 || value.seconds > 600)
        throw new Error('Use 1–100 turns and 5–600 seconds.');
    store.set({ turns: value.turns, seconds: value.seconds });
    return get();
}
module.exports = { get, set };
