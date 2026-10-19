import React, { useState } from 'react';
import { HELP_SITUATIONS } from '../content.js';
import { Callout, Icon, PageTitle } from '../components/ui.jsx';

export default function Help() {
  const [id, setId] = useState(null);
  const sit = HELP_SITUATIONS.find((s) => s.id === id);

  if (!sit) {
    return (
      <div>
        <PageTitle sub="Tell us what happened and we will show you what to do, in order. You are not alone, and it can happen to anyone.">Get help</PageTitle>
        <div className="grid gap-3">
          {HELP_SITUATIONS.map((s) => (
            <button key={s.id} onClick={() => setId(s.id)} className={`text-left flex items-center gap-4 rounded-xl border-2 bg-white p-5 min-h-tap hover:bg-sky-50 ${s.urgent ? 'border-scam' : 'border-slate-300'}`}>
              <span className="flex-1"><span className="block font-bold">{s.title}</span><span className="block text-slate-700 text-[1.05rem]">{s.hint}</span></span>
              <Icon name="chevron" className="w-6 h-6 text-slate-500" />
            </button>
          ))}
        </div>
        <p className="mt-6">Want to talk to someone now? Call the free <a className="link" href="tel:1799">ScamShield Helpline 1799</a>, open 24 hours.</p>
      </div>
    );
  }
  return (
    <div>
      <button className="btn-quiet !px-0 mb-2" onClick={() => setId(null)}>Back to all situations</button>
      <PageTitle>{sit.title}</PageTitle>
      {sit.urgent && <div className="mb-6"><Callout tone="urgent" title="Speed matters" icon="alert">Do step 1 first. Do not spend time on a report before you have called your bank.</Callout></div>}
      <ol className="grid gap-4">
        {sit.steps.map((s, i) => (
          <li key={s.t} className="flex gap-4 rounded-xl border-2 border-slate-300 bg-white p-5">
            <span className="grid place-items-center w-10 h-10 shrink-0 rounded-full bg-brand text-white font-bold" aria-hidden="true">{i + 1}</span>
            <div><p className="font-bold">{s.t}</p><p className="text-slate-800">{s.d}</p></div>
          </li>
        ))}
      </ol>
      <h2 className="text-lg font-bold mt-8 mb-3">Who to contact</h2>
      <ul className="grid gap-4">
        {sit.resources.map((r) => (
          <li key={r.id} className="rounded-xl border-2 border-slate-300 bg-white p-5">
            <p className="font-bold">{r.name}</p><p className="text-slate-700">{r.note}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {r.phone && <a className="btn-primary" href={`tel:${r.phone}`}><Icon name="phone" className="w-5 h-5" /> Call {r.phone}</a>}
              {r.url && <a className="btn-secondary" href={r.url} target="_blank" rel="noopener noreferrer">Open official page <Icon name="external" className="w-5 h-5" /></a>}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <a href="#/report" className="btn-secondary"><Icon name="flag" /> Prepare a report</a>
        <a href="#/check" className="btn-secondary"><Icon name="search" /> Check a message</a>
      </div>
    </div>
  );
}
