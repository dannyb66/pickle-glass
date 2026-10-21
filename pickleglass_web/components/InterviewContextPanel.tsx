'use client';

import { useEffect, useRef, useState } from 'react';
import { ContextPreview, InterviewList, InterviewProfile, documentUpload, interviewRequest, resumeHash } from '@/utils/interview';

const blankProfile = (): InterviewProfile => ({ revision: 0, name: '', company: '', role: '', level: '', minutes: 45,
  resume: { name: '', text: '', confirmed: false }, jd: { text: '', url: '' }, references: [] });
const inputClass = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const buttonClass = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
const primaryClass = 'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

export default function InterviewContextPanel() {
  const [profiles, setProfiles] = useState<InterviewProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeContext, setActiveContext] = useState<InterviewList['active']>(null);
  const [profile, setProfile] = useState<InterviewProfile>(blankProfile);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const owner = useRef<string>();
  const epoch = useRef(0);
  const resumeFile = useRef<HTMLInputElement>(null);
  const referenceFile = useRef<HTMLInputElement>(null);

  function message(text: string, isError = false) { setStatus(text); setError(isError); }
  function load(value?: InterviewProfile) { setProfile(value ? structuredClone(value) : blankProfile()); setDirty(false); setPreview(null); message(''); }
  function clearOwner() {
    epoch.current++; owner.current = undefined; setProfiles([]); setSelectedId(null); setActiveContext(null); load();
  }
  async function refresh(initial = false) {
    const currentEpoch = epoch.current;
    const result = await interviewRequest<InterviewList>('list');
    if (currentEpoch !== epoch.current) return;
    if (owner.current && owner.current !== result.ownerId) { clearOwner(); message('Desktop user changed. Loaded their interview profiles.'); }
    owner.current = result.ownerId;
    setProfiles(result.data.profiles); setSelectedId(result.data.selectedId);
    setActiveContext(result.data.active);
    if (initial) load(result.data.profiles.find(p => p.id === result.data.selectedId));
  }
  async function call<T>(action: string, payload?: unknown): Promise<T> {
    const currentEpoch = epoch.current;
    if (!owner.current) throw new Error('Wait for interview profiles to load, then retry.');
    const result = await interviewRequest<T>(action, owner.current, payload);
    if (currentEpoch !== epoch.current || result.ownerId !== owner.current) throw new Error('Desktop user changed. Reload interview context.');
    return result.data;
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); message('');
    try { await task(); }
    catch (err) {
      if ((err as { ownerChanged?: boolean }).ownerChanged) { clearOwner(); await refresh().catch(() => {}); }
      message(err instanceof Error ? err.message : 'Interview request failed.', true);
    } finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    refresh(true).catch(err => message(err.message, true)).finally(() => { if (active) setLoading(false); });
    const reload = () => { refresh().catch(() => {}); };
    window.addEventListener('focus', reload);
    window.addEventListener('userInfoChanged', reload);
    // Desktop account changes also arrive when the website remains open.
    const timer = window.setInterval(reload, 10000);
    return () => { active = false; epoch.current++; window.clearInterval(timer); window.removeEventListener('focus', reload); window.removeEventListener('userInfoChanged', reload); };
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  function edit(update: Partial<InterviewProfile>) { setProfile(p => ({ ...p, ...update })); setDirty(true); setPreview(null); }
  function choose(value?: InterviewProfile) { if (!dirty || window.confirm('Discard unsaved interview edits?')) load(value); }
  function savedId() { if (!profile.id || dirty) throw new Error('Save your edits before previewing or selecting this profile.'); return profile.id; }
  async function importFile(file: File | undefined, kind: 'resume' | 'reference') {
    if (!file) return;
    await run(async () => {
      if (kind === 'reference' && profile.references.length >= 6) throw new Error('Use at most six references.');
      const currentEpoch = epoch.current;
      const upload = await documentUpload(file);
      if (currentEpoch !== epoch.current) throw new Error('Desktop user changed. Import cancelled.');
      const source = await call<{ name: string; text: string }>('import', upload);
      if (kind === 'resume') edit({ resume: { ...source, confirmed: false } });
      else edit({ references: [...profile.references, source] });
      message('Document imported. Review the extracted text before saving.');
    });
  }
  const selected = profiles.find(p => p.id === selectedId);

  if (loading) return <p className="px-8 py-8 text-sm text-gray-500" role="status">Loading interview context…</p>;
  return <div className="px-4 py-6 sm:px-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold text-gray-900">Interview context</h2><p className="mt-1 text-sm text-gray-500">Prepare a resume, job description and references for each interview.</p></div>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => choose()}>New profile</button>
    </div>
    <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Saved interviews</h3>
        {!profiles.length && <p className="text-sm text-gray-500">No saved interviews yet. Create your first profile.</p>}
        <div className="space-y-2">{profiles.map(p => <button type="button" key={p.id} disabled={busy} onClick={() => choose(p)} aria-pressed={profile.id === p.id}
          className={`w-full rounded-md border p-3 text-left text-sm ${profile.id === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-400'}`}>
          <span className="block font-medium text-gray-900">{p.name}</span><span className="mt-1 block text-xs text-gray-500">{p.company || 'Interview'} · {p.role} · v{p.revision}</span>
          {p.id === selectedId && <span className="mt-2 inline-block text-xs font-medium text-blue-700">Selected for next session</span>}
        </button>)}</div>
        <p className="mt-4 text-sm text-gray-700">{selected ? `Next session: ${selected.name}` : 'Generic mode: no profile selected.'}</p>
        {activeContext && <p className="mt-2 text-sm font-medium text-blue-700">Active interview: {activeContext.name} · v{activeContext.revision}</p>}
        <button type="button" className={`${buttonClass} mt-3 w-full`} disabled={busy} onClick={() => run(async () => { await call('stop'); await refresh(); message('Interview stopped. Generic mode selected.'); })}>Stop interview / use generic mode</button>
        <p className="mt-4 text-xs leading-relaxed text-gray-500">Profiles and interview transcripts stay on this device. Starting or asking sends the selected context to your configured AI provider.</p>
      </aside>
      <form className="min-w-0" onSubmit={event => { event.preventDefault(); run(async () => {
        const currentEpoch = epoch.current;
        const confirmedHash = await resumeHash(profile.resume.text);
        if (currentEpoch !== epoch.current) throw new Error('Desktop user changed. Save cancelled.');
        const saved = await call<InterviewProfile>('save', { ...profile, resume: { ...profile.resume, confirmedHash } });
        load(saved); await refresh();
        if (currentEpoch !== epoch.current) throw new Error('Desktop user changed. Reload interview context.');
        message(`Saved ${saved.name} locally (revision ${saved.revision}). Preview and select it for the next session.`);
      }); }}>
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">Profile name<input className={inputClass} required maxLength={120} value={profile.name} onChange={e => edit({ name: e.target.value })} placeholder="Company — platform design" /></label>
            <label className="text-sm font-medium text-gray-700">Company<input className={inputClass} maxLength={200} value={profile.company} onChange={e => edit({ company: e.target.value })} /></label>
            <label className="text-sm font-medium text-gray-700">Role<input className={inputClass} required maxLength={200} value={profile.role} onChange={e => edit({ role: e.target.value })} /></label>
            <label className="text-sm font-medium text-gray-700">Round<input className={inputClass} value="System design" readOnly /></label>
            <label className="text-sm font-medium text-gray-700">Level<input className={inputClass} maxLength={120} value={profile.level} onChange={e => edit({ level: e.target.value })} placeholder="Senior / Staff" /></label>
            <label className="text-sm font-medium text-gray-700">Timebox (minutes)<input className={inputClass} type="number" min={10} max={180} value={profile.minutes} onChange={e => edit({ minutes: Number(e.target.value) })} /></label>
          </div>
          <section className="rounded-lg border border-gray-200 p-4">
            <h3 className="mb-4 font-semibold text-gray-900">1. Confirm your resume</h3>
            <div className="flex flex-wrap items-end gap-3"><label className="flex-1 text-sm font-medium text-gray-700">Resume name<input className={inputClass} required maxLength={180} value={profile.resume.name} onChange={e => edit({ resume: { ...profile.resume, name: e.target.value } })} placeholder="Resume version / file name" /></label>
              <button type="button" className={buttonClass} onClick={() => resumeFile.current?.click()}>Import resume</button>
              <input ref={resumeFile} type="file" accept=".docx,.txt,.md,.pdf" className="hidden" aria-label="Resume file" onChange={e => { importFile(e.target.files?.[0], 'resume'); e.target.value = ''; }} />
            </div>
            <p className="my-3 text-xs text-gray-500">DOCX, Markdown or UTF-8 text, up to 2 MiB. For a PDF, paste or export its text.</p>
            <label className="text-sm font-medium text-gray-700">Resume content<textarea className={inputClass} required rows={7} maxLength={100000} value={profile.resume.text} onChange={e => edit({ resume: { ...profile.resume, text: e.target.value, confirmed: false } })} placeholder="Paste the candidate’s actual resume" /></label>
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-700"><input className="mt-1" type="checkbox" required checked={profile.resume.confirmed} onChange={e => edit({ resume: { ...profile.resume, confirmed: e.target.checked } })} />I reviewed this exact resume text and confirm it is the version to use.</label>
          </section>
          <section className="rounded-lg border border-gray-200 p-4">
            <h3 className="mb-4 font-semibold text-gray-900">2. Review the job description</h3>
            <div className="flex flex-wrap items-end gap-3"><label className="flex-1 text-sm font-medium text-gray-700">Public HTTPS job URL (optional)<input className={inputClass} type="url" maxLength={2000} value={profile.jd.url} onChange={e => edit({ jd: { ...profile.jd, url: e.target.value } })} placeholder="https://company.example/jobs/role" /></label>
              <button type="button" className={buttonClass} onClick={() => run(async () => { const source = await call<{ text: string; url: string }>('fetch-jd', profile.jd.url); edit({ jd: source }); message('Job page fetched. Review and trim it to the actual job description before saving.'); })}>Fetch JD</button></div>
            <label className="mt-4 block text-sm font-medium text-gray-700">Job description<textarea className={inputClass} required rows={7} maxLength={100000} value={profile.jd.text} onChange={e => edit({ jd: { ...profile.jd, text: e.target.value } })} placeholder="Paste the JD, or fetch its URL and review the extracted text" /></label>
          </section>
          <section className="rounded-lg border border-gray-200 p-4">
            <h3 className="mb-1 font-semibold text-gray-900">3. Add system-design prep material</h3><p className="mb-4 text-xs text-gray-500">Up to six named excerpts. References inform technical answers; they do not become candidate experience.</p>
            {profile.references.map((ref, index) => <div key={index} className="mb-4 space-y-3 border-b border-gray-100 pb-4">
              <label className="block text-sm font-medium text-gray-700">Reference name / source<input className={inputClass} required maxLength={180} value={ref.name} onChange={e => edit({ references: profile.references.map((r, i) => i === index ? { ...r, name: e.target.value } : r) })} /></label>
              <label className="block text-sm font-medium text-gray-700">Selected excerpt<textarea className={inputClass} required maxLength={100000} rows={5} value={ref.text} onChange={e => edit({ references: profile.references.map((r, i) => i === index ? { ...r, text: e.target.value } : r) })} /></label>
              <button type="button" className={buttonClass} onClick={() => edit({ references: profile.references.filter((_, i) => i !== index) })}>Remove reference</button>
            </div>)}
            <div className="flex gap-3"><button type="button" className={buttonClass} disabled={profile.references.length >= 6} onClick={() => edit({ references: [...profile.references, { name: '', text: '' }] })}>Add reference</button>
              <button type="button" className={buttonClass} disabled={profile.references.length >= 6} onClick={() => referenceFile.current?.click()}>Import reference</button>
              <input ref={referenceFile} type="file" accept=".docx,.txt,.md,.pdf" className="hidden" aria-label="Reference file" onChange={e => { importFile(e.target.files?.[0], 'reference'); e.target.value = ''; }} /></div>
          </section>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primaryClass}>{busy ? 'Working…' : 'Save profile'}</button>
            <button type="button" className={buttonClass} disabled={!profile.id || dirty} onClick={() => run(async () => setPreview(await call<ContextPreview>('preview', savedId())))}>Preview saved context</button>
            <button type="button" className={buttonClass} disabled={!profile.id || dirty} onClick={() => run(async () => { await call('select', savedId()); await refresh(); message('Selected for the next fresh session. Any current session keeps its original context.'); })}>Select for next session</button>
            <button type="button" className={`${buttonClass} text-red-600`} disabled={!profile.id} onClick={() => run(async () => {
              if (!window.confirm('Delete this profile and its context snapshots? Any active session using it stops. Previous answers and bytes already sent to providers are not erased.')) return;
              const result = await call<{ notice: string }>('remove', profile.id); load(); await refresh(); message(result.notice);
            })}>Delete profile</button>
          </div>
          {preview && <details open className="rounded-lg border border-gray-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-gray-900">Exact context sent to the AI</summary>
            <p className="my-3 break-all text-xs text-gray-500">{preview.characters} characters · approximately {preview.estimatedTokens} tokens. {preview.truncated ? 'Some sources are truncated; review the exact excerpt below.' : 'All source text fits.'} Packet SHA-256: {preview.sha256}</p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-xs text-gray-800">{preview.text}</pre></details>}
          <section className="rounded-lg border border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold text-gray-900">Start a fresh interview</h3>
            <p className="my-3 text-sm leading-relaxed text-gray-600">{selected ? `Ready to start: ${selected.name}. ` : 'Save and select a profile first. '}Start prepares a fresh, pinned context for Ask and Insights. Use Listen in Glass to add audio. Editing a profile does not change an active session.</p>
            <button type="button" className={primaryClass} disabled={!selectedId || dirty} onClick={() => run(async () => {
              const currentEpoch = epoch.current;
              message('Preparing a fresh interview context…');
              const result = await call<{ snapshot: ContextPreview }>('start'); await refresh();
              if (currentEpoch !== epoch.current) throw new Error('Desktop user changed. Reload interview context.');
              message(`Interview ready: ${result.snapshot.packet.name}, revision ${result.snapshot.packet.revision}. Use Ask now, or Listen in Glass to start audio.`);
            })}>Start selected interview</button>
          </section>
        </fieldset>
        <p role={error ? 'alert' : 'status'} aria-live="polite" className={`mt-4 whitespace-pre-wrap text-sm ${error ? 'text-red-700' : 'text-blue-700'}`}>{status}</p>
      </form>
    </div>
  </div>;
}
