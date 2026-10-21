'use client';

import { useEffect, useState } from 'react';
import InterviewContextPanel from '@/components/InterviewContextPanel';
import PresetsPanel from '@/components/PresetsPanel';

export default function PersonalizePage() {
  const [tab, setTab] = useState('interview');
  useEffect(() => {
    const sync = () => setTab(new URLSearchParams(window.location.search).get('tab') === 'presets' ? 'presets' : 'interview');
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  function select(value: string) {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', value);
    window.history.replaceState(null, '', url);
  }
  return <div className="min-h-full bg-white">
    <header className="border-b border-gray-200 px-4 pt-8 sm:px-8">
      <h1 className="text-3xl font-bold text-gray-900">Personalize</h1>
      <p className="mt-2 text-sm text-gray-500">Manage your interview context and assistant instructions.</p>
      <div role="tablist" aria-label="Personalize" className="mt-6 flex gap-6">
        {[['interview', 'Interview Context'], ['presets', 'Prompt Presets']].map(([value, label]) => <button type="button" role="tab" key={value} id={`tab-${value}`} aria-selected={tab === value} aria-controls={`panel-${value}`} tabIndex={tab === value ? 0 : -1} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'interview' : event.key === 'End' ? 'presets' : value === 'interview' ? 'presets' : 'interview';
          select(next); document.getElementById(`tab-${next}`)?.focus();
        }} onClick={() => select(value)} className={`border-b-2 pb-3 text-sm font-medium ${tab === value ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>{label}</button>)}
      </div>
    </header>
    <div role="tabpanel" id="panel-interview" aria-labelledby="tab-interview" hidden={tab !== 'interview'}><InterviewContextPanel /></div>
    <div role="tabpanel" id="panel-presets" aria-labelledby="tab-presets" hidden={tab !== 'presets'}><PresetsPanel /></div>
  </div>;
}
