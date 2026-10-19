import React from 'react';
import { SCAM_TYPES } from '../content.js';
import { PageTitle } from '../components/ui.jsx';

export default function Learn() {
  return (
    <div>
      <PageTitle sub="Scammers use a few tricks again and again. Knowing them makes you much harder to fool.">Common scams</PageTitle>
      <div className="rounded-xl border-2 border-brand bg-sky-50 p-5 mb-6">
        <p className="font-bold text-brand">Three rules that beat most scams</p>
        <ul className="list-disc pl-6 mt-2 grid gap-1">
          <li>No real bank or officer ever asks for your OTP or password.</li>
          <li>Do not click links in surprise messages. Open the official app yourself.</li>
          <li>Slow down. Pressure to act fast is the scammer's main tool.</li>
        </ul>
      </div>
      <div className="grid gap-3">
        {SCAM_TYPES.map((s) => (
          <details key={s.id} className="group rounded-xl border-2 border-slate-300 bg-white open:border-brand">
            <summary className="cursor-pointer list-none p-5 min-h-tap flex items-center justify-between gap-3 font-bold">
              {s.title}<span aria-hidden="true" className="text-brand text-xl group-open:rotate-90 transition-transform">›</span>
            </summary>
            <div className="px-5 pb-5 grid gap-4">
              <p>{s.how}</p>
              <div><p className="font-bold">Warning signs</p><ul className="list-disc pl-6">{s.signs.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div><p className="font-bold">What to do</p><p>{s.todo}</p></div>
            </div>
          </details>
        ))}
      </div>
      <p className="mt-8">Unsure about something you received? <a className="link" href="#/check">Check a message</a> or call <a className="link" href="tel:1799">1799</a>.</p>
    </div>
  );
}
