const path = require('node:path');
let window;
function open() {
    const { BrowserWindow } = require('electron');
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    window = new BrowserWindow({ width: 1050, height: 830, minWidth: 750, minHeight: 600, title: 'Interview Profiles — Pickle Glass', backgroundColor: '#111827', webPreferences: { preload: path.resolve(__dirname, '../../..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
    window.loadFile(path.resolve(__dirname, '../../../ui/interview/profiles.html'));
    window.on('closed', () => { window = null; });
    return window;
}
module.exports = { open };
