import React, { useState } from 'react';
import { analyzeMessage } from '../api.js';
import { Callout, ErrorBox, Icon, MarkedMessage, MicButton, PageTitle, ScreenshotButton, Spinner, levelStyle, onPasteImage } from '../components/ui.jsx';

const EXAMPLES = [
  'Eh bro, your bank account kena locked already. Click here to verify: dbs-sg-secure.top/login',
  'Dinner at 7 lah, I already book the table at the usual place.',
  'Hi, I\'m from the bank. Need your OTP to verify your account.',
];
const MAX = 4000;

export default function Check({ session, setSession }) {
  const [text, setText] = useState(session.message || '');
  const [state, setState] = useState(session.analysis ? 'done' : 'idle'); // idle | reading | loading | done | error
  const [fromImage, setFromImage] = useState(false);
  const [noRetry, setNoRetry] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(session.analysis ? { analysis: session.analysis, meta: session.meta } : null);

  async function run() {
    const msg = text.trim();
    if (!msg) { setError('Please paste the message you want checked.'); setState('error'); return; }
    setState('loading'); setError(''); setNoRetry(false);
    try {
      const r = await analyzeMessage(msg);
      setResult(r); setState('done');
      setSession({ message: r.analysis.original, analysis: r.analysis, meta: r.meta });
    } catch (e) { setError(e.message); setState('error'); }
  }
  async function paste() {
    try { setText((await navigator.clipboard.readText()).slice(0, MAX)); } catch { setError('Your phone or browser did not allow pasting. Press and hold in the box, then tap Paste.'); setState('error'); }
  }
  const shot = {
    onText: (t, method) => { setText(t.slice(0, MAX)); setFromImage(method || true); setState('idle'); setError(''); setResult(null); },
    onError: (msg) => { setError(msg); setNoRetry(true); setState('error'); },
    onBusy: (b) => { if (b) { setState('reading'); setError(''); } },
  };
  function reset() { setText(''); setFromImage(false); setResult(null); setState('idle'); setError(''); setSession({ message: '', analysis: null, meta: null }); }

  const a = result?.analysis;
  const st = a && levelStyle(a.riskLevel);

  return (
    <div>
      <PageTitle sub="Paste the message below. We will explain what looks risky and what to do next.">Check a message</PageTitle>

      <label htmlFor="msg" className="block font-bold mb-2">The message</label>
      <textarea id="msg" className="field min-h-[180px]" value={text} maxLength={MAX} onChange={(e) => { setText(e.target.value); }} onPaste={onPasteImage(shot)}
        placeholder="Paste the SMS, WhatsApp or email text here, or a screenshot" aria-describedby="msg-help" disabled={state === 'loading' || state === 'reading'} />
      <p id="msg-help" className="mt-2 text-slate-600 text-[1.05rem]">{text.length}/{MAX}. Hide any real OTP or password before you paste. We never open links in your message.</p>
      {fromImage && text && state !== 'done' && (
        <div className="mt-3"><Callout tone="info" icon="image" title="We read this from your screenshot">
          <p>Please check the words above and fix anything that looks wrong, then tap Check this message.{fromImage === 'ocr' ? ' Small or blurry text is sometimes misread.' : ''}</p>
        </Callout></div>
      )}

      <button className="btn-primary w-full mt-4" onClick={run} disabled={state === 'loading' || state === 'reading'}><Icon name="search" /> Check this message</button>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button className="btn-secondary" onClick={paste} disabled={state === 'loading' || state === 'reading'}><Icon name="copy" /> Paste from clipboard</button>
        <ScreenshotButton {...shot} disabled={state === 'loading' || state === 'reading'} />
        <MicButton disabled={state === 'loading' || state === 'reading'} onText={(said) => setText((t) => (t ? `${t} ${said}` : said).slice(0, MAX))} />
      </div>

      {state === 'idle' && !text && (
        <div className="mt-6">
          <p className="font-bold">No message handy? Try an example:</p>
          <div className="mt-2 grid gap-2">
            {EXAMPLES.map((ex) => <button key={ex} className="text-left rounded-xl border-2 border-slate-300 bg-white p-4 hover:bg-sky-50 min-h-tap" onClick={() => setText(ex)}>{ex}</button>)}
          </div>
        </div>
      )}

      <div className="mt-6" aria-live="polite">
        {state === 'reading' && <Spinner label="Reading the words in your screenshot…" />}
        {state === 'loading' && <Spinner label="Reading your message. This takes a few seconds…" />}
        {state === 'error' && <ErrorBox message={error} onRetry={noRetry || error.startsWith('Please paste') || error.startsWith('Your phone') ? undefined : run} />}
      </div>

      {state === 'done' && a && (
        <section className="mt-6 grid gap-6" aria-labelledby="result-h">
          {a.urgent && (
            <Callout tone="urgent" title={a.urgent.title} icon="alert">
              <p className="mb-2">It sounds like {a.urgent.because.join(' and ')}. Do these first:</p>
              <ol className="list-decimal pl-6 grid gap-2">{a.urgent.actions.map((x) => <li key={x}>{x}</li>)}</ol>
              <a href="#/help" className="btn-danger mt-4 w-full sm:w-auto">Open the full help guide</a>
            </Callout>
          )}

          <div className={`rounded-xl border-2 ${st.border} ${st.bg} overflow-hidden`}>
            <div className={`${st.bar} text-white px-5 py-2 font-bold flex items-center gap-2`}><Icon name={st.icon} className="w-5 h-5" />{st.label}</div>
            <div className="p-5">
              <h2 id="result-h" className={`text-lg font-bold ${st.text}`}>{a.headline}</h2>
              <p className="mt-2">{a.summary}</p>
              {a.scamCategory !== 'unclear' && a.riskLevel !== 'insufficient_evidence' && <p className="mt-2 text-slate-700">Looks like: <strong>{a.scamCategoryLabel}</strong></p>}
              {a.riskLevel === 'insufficient_evidence' && <p className="mt-3 font-bold">This is not a safety check. If you are unsure, do not click or reply, and call 1799.</p>}
            </div>
          </div>

          {a.notes.length > 0 && <Callout tone="warn" title="Please note" icon="alert">{a.notes.map((n) => <p key={n}>{n}</p>)}</Callout>}

          <div>
            <h3 className="text-lg font-bold mb-2">Your message{a.suspiciousPhrases.length ? ', with the worrying parts marked' : ''}</h3>
            <MarkedMessage text={a.original} phrases={a.suspiciousPhrases} level={a.riskLevel} />
            {a.suspiciousPhrases.length > 0 && (
              <ul className="mt-3 grid gap-2">
                {a.suspiciousPhrases.map((p) => <li key={p.text} className="pl-4 border-l-4 border-careful"><strong>"{p.text}"</strong>{p.why && <span className="text-slate-700">: {p.why}</span>}</li>)}
              </ul>
            )}
            {a.suspiciousPhrases.length === 0 && <p className="mt-2 text-slate-700">We did not find specific phrases to mark.</p>}
          </div>

          {a.reasons.length > 0 && (
            <div><h3 className="text-lg font-bold mb-2">Why we say this</h3><ul className="list-disc pl-6 grid gap-2">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
          )}

          {a.links.some((l) => l.warnings.length) && (
            <Callout tone="warn" title="About the links (do not open them)" icon="alert">
              <ul className="grid gap-3">{a.links.filter((l) => l.warnings.length).map((l) => <li key={l.link}><span className="font-bold break-all">{l.host || l.link}</span><ul className="list-disc pl-6">{l.warnings.map((w) => <li key={w}>{w}</li>)}</ul></li>)}</ul>
            </Callout>
          )}

          {(a.interpretation.plainEnglish || a.interpretation.languageNotes) && (
            <Callout tone="neutral" title="How we read your message">
              {a.interpretation.plainEnglish && <p>{a.interpretation.plainEnglish}</p>}
              {a.interpretation.languageNotes && <p className="mt-2 text-slate-700">{a.interpretation.languageNotes}</p>}
              <p className="mt-2 text-slate-600 text-[1.05rem]">This is only a reading aid. The report always uses your original words.</p>
            </Callout>
          )}

          {a.missingInfo.length > 0 && a.riskLevel !== 'high_risk' && (
            <div><h3 className="text-lg font-bold mb-2">What would help us judge</h3><ul className="list-disc pl-6 grid gap-1">{a.missingInfo.map((m) => <li key={m}>{m}</li>)}</ul></div>
          )}

          <div>
            <h3 className="text-lg font-bold mb-2">What to do now</h3>
            <ol className="list-decimal pl-6 grid gap-2">{a.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {a.riskLevel !== 'insufficient_evidence' && <a href="#/report" className="btn-primary"><Icon name="flag" /> Prepare a report</a>}
            <a href="#/share" className="btn-secondary"><Icon name="lock" /> Warn family safely</a>
            <a href="#/help" className="btn-secondary"><Icon name="lifebuoy" /> I need help</a>
            <a href="tel:1799" className="btn-secondary"><Icon name="phone" /> Call 1799</a>
            <button className="btn-quiet" onClick={reset}>Check another message</button>
          </div>
          <p className="text-slate-600 text-[1.05rem]">{a.disclaimer}</p>
        </section>
      )}
    </div>
  );
}
