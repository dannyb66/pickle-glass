// Interview management lives in the existing local website.
async function open() {
    const url = new URL('/personalize?tab=interview', process.env.pickleglass_WEB_URL || 'http://localhost:3000');
    await require('electron').shell.openExternal(url.href);
}
module.exports = { open };
