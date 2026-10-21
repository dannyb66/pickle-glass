const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { LIMITS, hash } = require('../prompts/interviewContext');
const MAX_BYTES = 2 * 1024 * 1024;
const blocked = new net.BlockList();
['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4'].forEach(cidr => { const [address, prefix] = cidr.split('/'); blocked.addSubnet(address, Number(prefix), 'ipv4'); });
['::/96','::1/128','64:ff9b::/96','64:ff9b:1::/48','fc00::/7','fe80::/10','ff00::/8','2001::/32','2001:db8::/32','2002::/16'].forEach(cidr => { const [address, prefix] = cidr.split('/'); blocked.addSubnet(address, Number(prefix), 'ipv6'); });
function isPublic(address) {
    if (!net.isIP(address) || address.toLowerCase().includes('::ffff:')) return false;
    return !blocked.check(address, net.isIP(address) === 4 ? 'ipv4' : 'ipv6');
}
function decode(text) { return text.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (all, num, named) => {
    if (num) { const n = num[0].toLowerCase() === 'x' ? parseInt(num.slice(1), 16) : Number(num); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[named.toLowerCase()];
}); }
function htmlText(html) { return decode(html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h[1-6]|li|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim(); }
function result(name, text, parser) {
    text = text.replace(/\u0000/g, '').trim();
    if (!text) throw new Error('No readable text found. Paste the document text instead.');
    if (text.length > LIMITS.input) throw new Error(`Source exceeds ${LIMITS.input} characters. Choose a smaller excerpt.`);
    return { name, text, sha256: hash(text), parser };
}
async function importFile(filePath) {
    const stat = await fs.stat(filePath); if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Choose a document smaller than 2 MiB.');
    return importDocument(path.basename(filePath), await fs.readFile(filePath));
}
async function importDocument(name, bytes) {
    if (typeof name !== 'string' || !Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw new Error('Choose a document smaller than 2 MiB.');
    name = path.basename(name);
    const ext = path.extname(name).toLowerCase();
    if (['.txt', '.md'].includes(ext)) return result(name, new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'utf8-v1');
    if (ext === '.pdf') throw new Error('PDF import is not supported yet. Export the PDF as text or paste its readable content. DOCX, Markdown and UTF-8 text are supported.');
    if (ext !== '.docx') throw new Error('Choose DOCX, Markdown or UTF-8 text, or paste the content.');
    const yauzl = require('yauzl');
    const xml = await new Promise((resolve, reject) => {
        yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
            if (error) return reject(new Error('Unreadable DOCX. Paste its text instead.'));
            let settled = false; let entries = 0;
            const fail = err => { if (!settled) { settled = true; zip.close(); reject(err); } };
            zip.on('error', fail); zip.on('end', () => fail(new Error('DOCX document text not found.')));
            zip.on('entry', entry => {
                if (++entries > 5000) return fail(new Error('DOCX contains too many entries.'));
                if (entry.fileName !== 'word/document.xml') return zip.readEntry();
                if (entry.uncompressedSize > MAX_BYTES) return fail(new Error('DOCX text exceeds 2 MiB.'));
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError) return fail(streamError);
                    const chunks = []; let total = 0;
                    stream.on('error', fail); stream.on('data', chunk => { total += chunk.length; if (total > MAX_BYTES) { stream.destroy(); fail(new Error('DOCX text exceeds 2 MiB.')); } else chunks.push(chunk); });
                    stream.on('end', () => { if (!settled) { settled = true; zip.close(); resolve(Buffer.concat(chunks).toString('utf8')); } });
                });
            });
            zip.readEntry();
        });
    });
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported DOCX XML declarations.');
    const text = decode(xml.replace(/<w:tab\b[^>]*\/?\s*>/g, '\t').replace(/<w:br\b[^>]*\/?\s*>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''));
    return result(name, text, 'docx-xml-v1');
}
async function fetchJobDescription(input, options = {}) {
    let url;
    try { url = new URL(input); } catch { throw new Error('Enter a public HTTPS job-description URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Use a public HTTPS URL without credentials or a custom port.');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const deadline = options.deadline || Date.now() + 12000;
    const remaining = () => Math.max(1, deadline - Date.now());
    let dnsTimer;
    const addresses = await Promise.race([
        (options.lookup || dns.lookup)(hostname, { all: true }),
        new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('Job-page DNS lookup timed out. Paste the JD instead.')), remaining()); })
    ]).finally(() => clearTimeout(dnsTimer));
    if (Date.now() >= deadline) throw new Error('Job-page request timed out. Paste the JD instead.');
    if (!addresses.length || addresses.some(row => !isPublic(row.address))) throw new Error('Only public internet job-description URLs are allowed.');
    const selected = addresses[0];
    const response = await new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'PickleGlass/InterviewContext', Accept: 'text/html,text/plain' }, lookup: (_hostname, lookupOptions, callback) => callback(null, lookupOptions.all ? [{ address: selected.address, family: selected.family }] : selected.address, selected.family) }, res => {
            const chunks = []; let size = 0;
            res.on('error', reject); res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { res.destroy(); reject(new Error('Job page exceeds 2 MiB. Paste a short JD instead.')); } else chunks.push(chunk); });
            res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, type: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }));
        });
        const totalTimer = setTimeout(() => req.destroy(new Error('Job-page request timed out. Paste the JD instead.')), remaining());
        req.on('close', () => clearTimeout(totalTimer)); req.on('error', reject);
    });
    if (response.status >= 300 && response.status < 400 && response.location) {
        if ((options.redirects || 0) >= 3) throw new Error('Too many redirects. Paste the JD instead.');
        return fetchJobDescription(new URL(response.location, url).href, { ...options, redirects: (options.redirects || 0) + 1, deadline });
    }
    if (response.status !== 200 || !/text\/(html|plain)/i.test(response.type)) throw new Error('Job page was unavailable or unreadable. Paste the JD instead.');
    return { ...result('Job description', /html/i.test(response.type) ? htmlText(response.body) : response.body, 'public-https-text-v1'), url: url.href };
}
module.exports = { importDocument, importFile, fetchJobDescription, isPublic, htmlText, decode, MAX_BYTES };
