const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') throw new Error('This build requires macOS.');

const root = path.resolve(__dirname, '..');
const staging = path.join(root, 'dist/local-app');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

for (const relative of ['package.json', 'package-lock.json', 'src', 'public/build', 'pickleglass_web/backend_node']) {
    fs.cpSync(path.join(root, relative), path.join(staging, relative), { recursive: true, dereference: true });
}

// Packaging's npm dependency discovery cannot follow modules linked to another
// checkout. Materialize the installed dependencies in this disposable build
// directory; electron-builder still includes only production dependencies.
console.log('Preparing self-contained dependencies for the Mac build...');
execFileSync('/bin/cp', ['-RL', path.join(root, 'node_modules'), staging], { stdio: 'inherit' });
