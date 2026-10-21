const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'dist/local/mac-arm64/Glass.app');
const identity = process.env.GLASS_SIGNING_IDENTITY || '-';
// A local ad-hoc signature requires no Apple Developer account or certificate.
execFileSync('/usr/bin/codesign', [
    '--force', '--deep', '--sign', identity, '--options', 'runtime',
    '--entitlements', path.join(root, 'entitlements.plist'), bundle,
], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
fs.rmSync(path.join(root, 'dist/local-app'), { recursive: true, force: true });
