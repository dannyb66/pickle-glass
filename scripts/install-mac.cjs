const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') throw new Error('This installer requires macOS.');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist/local/mac-arm64/Glass.app');
const destination = '/Applications/Glass.app';
const staging = `/Applications/.Glass-install-${process.pid}.app`;

if (!fs.existsSync(source)) throw new Error('Build the local Mac app before installing.');
const processes = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' });
if (processes.split('\n').some(command =>
    command.startsWith(`${destination}/Contents/MacOS/Glass`) ||
    (command.includes('/Electron.app/Contents/MacOS/Electron ') && command.includes(root)))) {
    throw new Error('Quit Glass before replacing the installed app.');
}

execFileSync('/usr/bin/ditto', [source, staging], { stdio: 'inherit' });
if (fs.existsSync(destination)) {
    const backup = path.join(root, 'dist', `Glass-previous-${Date.now()}.app`);
    fs.renameSync(destination, backup);
    console.log(`Previous app saved to ${backup}`);
}
fs.renameSync(staging, destination);
execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', destination]);
console.log('Installed /Applications/Glass.app. Launch with Spotlight or: open -a Glass');
