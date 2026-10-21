const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

if (process.platform !== 'darwin') throw new Error('This installer requires macOS.');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist/local/mac-arm64/Glass.app');
const destination = '/Applications/Glass.app';
const staging = `/Applications/.Glass-install-${process.pid}.app`;
const registrar = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const unregister = bundle => {
    // Unregistered build copies are expected on a first install.
    const result = spawnSync(registrar, ['-u', bundle], { stdio: 'ignore' });
    if (result.error) throw result.error;
};

if (!fs.existsSync(source)) throw new Error('Build the local Mac app before installing.');
const processes = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' });
if (processes.split('\n').some(command =>
    command.startsWith(`${destination}/Contents/MacOS/Glass`) ||
    (command.includes('/Electron.app/Contents/MacOS/Electron ') && command.includes(root)))) {
    throw new Error('Quit Glass before replacing the installed app.');
}

execFileSync('/usr/bin/ditto', [source, staging], { stdio: 'inherit' });
if (fs.existsSync(destination)) {
    unregister(destination);
    const backup = path.join(root, 'dist', `Glass-previous-${Date.now()}.app`);
    fs.renameSync(destination, backup);
    console.log(`Previous app saved to ${backup}`);
}
fs.renameSync(staging, destination);
// Keep generated copies out of app/protocol selection. Only the installed copy
// should be offered when granting screen access or opening Glass links.
unregister(source);
for (const name of fs.readdirSync(path.join(root, 'dist'))) {
    if (name.startsWith('Glass-previous-') && name.endsWith('.app')) unregister(path.join(root, 'dist', name));
}
execFileSync(registrar, ['-f', destination]);
console.log('Installed /Applications/Glass.app. Launch with Spotlight or: open -a Glass');
