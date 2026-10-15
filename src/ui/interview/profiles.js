'use strict';
const api = window.api.interview;
const $ = id => document.getElementById(id);
let savedProfiles = [];
let selectedId = null;
let dirty = false;
let ownerEpoch = 0;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function call(method, ...args) { const epoch = ownerEpoch; const response = await api[method](...args); if (epoch !== ownerEpoch) throw new Error('User changed. Reopen or reload your interview profiles.'); if (!response.success) throw new Error(response.error); return response.data; }
async function guarded(fn) { try { await fn(); } catch (error) { status(error.message, true); } }
async function sha256(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(value => value.toString(16).padStart(2, '0')).join(''); }
function reference(ref = { name: '', text: '' }) {
    const row = document.createElement('div'); row.className = 'reference';
    const nameLabel = document.createElement('label'); nameLabel.textContent = 'Reference name / source';
    const name = document.createElement('input'); name.className = 'reference-name'; name.maxLength = 180; name.required = true; name.value = ref.name; nameLabel.append(name);
    const textLabel = document.createElement('label'); textLabel.textContent = 'Selected excerpt';
    const text = document.createElement('textarea'); text.className = 'reference-text'; text.rows = 5; text.maxLength = 100000; text.required = true; text.value = ref.text; textLabel.append(text);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove reference'; remove.onclick = () => { row.remove(); dirty = true; };
    row.append(nameLabel, textLabel, remove); $('references').append(row);
}
function load(profile) {
    $('profile-form').reset(); $('references').replaceChildren();
    for (const name of ['id', 'revision', 'name', 'company', 'role', 'level', 'minutes']) $(name === 'id' || name === 'revision' ? `profile-${name}` : name).value = profile?.[name] ?? (name === 'minutes' ? 45 : name === 'revision' ? 0 : '');
    $('resume-name').value = profile?.resume?.name || ''; $('resume-text').value = profile?.resume?.text || ''; $('resume-confirmed').checked = !!profile?.resume?.confirmed;
    $('jd-url').value = profile?.jd?.url || ''; $('jd-text').value = profile?.jd?.text || '';
    (profile?.references || []).forEach(reference);
    $('context-preview').textContent = ''; $('context-details').open = false; dirty = false;
    status(profile ? `Editing ${profile.name}, revision ${profile.revision}. Active sessions keep their pinned version.` : 'New profile. Import or paste a resume and review it before saving.');
}
async function refresh() {
    const data = await call('list'); savedProfiles = data.profiles; selectedId = data.selectedId; $('profiles').replaceChildren();
    for (const profile of savedProfiles) {
        const button = document.createElement('button'); button.className = `profile${profile.id === selectedId ? ' active' : ''}`; button.dataset.profileId = profile.id;
        button.textContent = profile.name; const subtitle = document.createElement('small'); subtitle.textContent = `${profile.company || 'Interview'} · ${profile.role} · v${profile.revision}${profile.id === selectedId ? ' · Selected' : ''}`; button.append(subtitle);
        button.onclick = () => { if (!dirty || confirm('Discard unsaved edits?')) load(profile); }; $('profiles').append(button);
    }
    if (!savedProfiles.length) $('profiles').textContent = 'No saved interviews yet.';
    $('selected-state').textContent = selectedId ? `Next session: ${savedProfiles.find(profile => profile.id === selectedId)?.name || 'saved profile'}` : 'Generic mode: no profile selected.';
}
function savedId() { const id = $('profile-id').value; if (!id || dirty) throw new Error('Save your current edits before selecting or previewing.'); return id; }
$('profile-form').addEventListener('input', event => { dirty = true; if (event.target.id === 'resume-text') $('resume-confirmed').checked = false; });
$('profile-form').addEventListener('submit', event => { event.preventDefault(); guarded(async () => {
    const epoch = ownerEpoch;
    const text = $('resume-text').value.trim();
    const profile = { id: $('profile-id').value || undefined, revision: Number($('profile-revision').value), name: $('name').value, company: $('company').value, role: $('role').value, level: $('level').value, minutes: Number($('minutes').value),
        resume: { name: $('resume-name').value, text, confirmed: $('resume-confirmed').checked, confirmedHash: await sha256(text) }, jd: { text: $('jd-text').value, url: $('jd-url').value },
        references: Array.from(document.querySelectorAll('.reference')).map(row => ({ name: row.querySelector('.reference-name').value, text: row.querySelector('.reference-text').value })) };
    if (epoch !== ownerEpoch) throw new Error('User changed. Resume save cancelled.');
    const saved = await call('save', profile); await refresh(); load(saved); status(`Saved ${saved.name} locally (revision ${saved.revision}). Preview and select it for the next session.`);
}); });
$('new-profile').onclick = () => { if (!dirty || confirm('Discard unsaved edits?')) load(null); };
$('import-resume').onclick = () => guarded(async () => { const source = await call('importFile'); if (!source) return; $('resume-name').value = source.name; $('resume-text').value = source.text; $('resume-confirmed').checked = false; dirty = true; status('Resume imported locally. Review the extracted text, then confirm it.'); });
$('fetch-jd').onclick = () => guarded(async () => { $('fetch-jd').disabled = true; try { const source = await call('fetchJD', $('jd-url').value); $('jd-text').value = source.text; $('jd-url').value = source.url; dirty = true; status('Fetched public job-page text. Review and trim it to the actual JD before saving.'); } finally { $('fetch-jd').disabled = false; } });
$('add-reference').onclick = () => { if (document.querySelectorAll('.reference').length >= 6) return status('Use at most six references.', true); reference(); dirty = true; };
$('import-reference').onclick = () => guarded(async () => { if (document.querySelectorAll('.reference').length >= 6) throw new Error('Use at most six references.'); const source = await call('importFile'); if (source) { reference(source); dirty = true; } });
$('preview').onclick = () => guarded(async () => { const preview = await call('preview', savedId()); $('context-preview').textContent = preview.text; $('budget').textContent = `${preview.characters} characters; approximately ${preview.estimatedTokens} tokens (estimate). ${preview.truncated ? 'Some sources are truncated; review the exact excerpt below.' : 'All source text fits.'} Packet SHA-256: ${preview.sha256}`; $('context-details').open = true; });
$('select').onclick = () => guarded(async () => { await call('select', savedId()); await refresh(); status('Selected for the next fresh session. Any current session keeps its original context.'); });
$('delete').onclick = () => guarded(async () => { const id = $('profile-id').value; if (!id) throw new Error('Choose a saved profile.'); if (!confirm('Delete this profile and its saved context snapshots? Any active session using it stops. Previous generated answers and bytes sent to providers are not erased.')) return; const result = await call('remove', id); await refresh(); load(null); status(result.notice); });
$('start-session').onclick = () => guarded(async () => { if (dirty) throw new Error('Save your edits before starting.'); $('start-session').disabled = true; try { status('Starting a fresh session with the selected context and configured audio provider…'); const result = await call('start'); status(`Interview started: ${result.snapshot.packet.name}, revision ${result.snapshot.packet.revision}. Audio and screen observations accompany this pinned profile in Ask. Session ${result.sessionId}`); } finally { $('start-session').disabled = false; } });
$('stop-session').onclick = () => guarded(async () => { await call('stop'); await refresh(); status('Interview stopped. Generic mode selected.'); });
guarded(async () => { await refresh(); load(null); });

api.onOwnerChanging(() => { ownerEpoch += 1; savedProfiles = []; selectedId = null; $('profiles').replaceChildren(); load(null); status('User changed. Waiting for the new local profile list.'); });
api.onUserChanged(() => { ownerEpoch += 1; savedProfiles = []; selectedId = null; $('profiles').replaceChildren(); load(null); guarded(refresh); });
