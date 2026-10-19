import React, { useEffect, useMemo, useRef, useState } from 'react';
import { draftReport } from '../api.js';
import { formatReportText } from '../../shared/formatReport.js';
import { Callout, ErrorBox, Icon, MicButton, PageTitle, Spinner } from '../components/ui.jsx';

const STATUS_TEXT = { provided: 'Added by you', extracted: 'Found in your message', unconfirmed: 'Not confirmed: please check', missing: 'Missing' };
const STATUS_STYLE = { provided: 'text-slate-700', extracted: 'text-slate-700', unconfirmed: 'text-careful', missing: 'text-scam' };

export default function Report({ session, setSession }) {
  const [message, setMessage] = useState(session.message || '');
  const [started, setStarted] = useState(Boolean(session.message));
  const a = session.analysis;
  const [details, setDetails] = useState(() => ({
    category: a?.scamCategory, riskLevel: a?.riskLevel, forwardedFrom: a?.extracted?.forwardedFrom || '',
    ...(a?.victimState?.clickedLink ? { clickedLink: true } : {}),
    ...(a?.victimState?.transferredMoney ? { moneyLost: true } : {}),
  }));
  const [overrides, setOverrides] = useState({});
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!started || !message.trim()) return;
    const id = ++seq.current;
    setState('loading');
    const t = setTimeout(async () => {
      try {
        const r = await draftReport(message, details);
        if (id !== seq.current) return;
        setDraft(r.report); setState('ready'); setError('');
      } catch (e) { if (id === seq.current) { setError(e.message); setState('error'); } }
    }, 250);
    return () => clearTimeout(t);
  }, [started, message, details]);

  const fields = useMemo(() => (draft?.fields || []).map((f) => (f.key in overrides ? { ...f, value: overrides[f.key], status: overrides[f.key].trim() ? 'provided' : 'missing' } : f)), [draft, overrides]);
  const text = useMemo(() => (draft ? formatReportText(fields, { createdAt: draft.createdAt }) : ''), [fields, draft]);
  const set = (k, v) => { setDetails((d) => ({ ...d, [k]: v })); setCopied(false); };
  const edit = (k, v) => { setOverrides((o) => ({ ...o, [k]: v })); setCopied(false); };

  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); }
    setCopied(true);
  }

  if (!started) {
    return (
      <div>
        <PageTitle sub="Start from the message you received. We will prepare a draft for you to check. Nothing is sent anywhere.">Report a scam</PageTitle>
        <Callout tone="neutral" title="Already checked a message?" icon="search"><a className="link" href="#/check">Go to Check a message</a>, then choose "Prepare a report". It fills in more details for you.</Callout>
        <label htmlFor="rmsg" className="block font-bold mt-6 mb-2">Or paste the scam message here</label>
        <textarea id="rmsg" className="field min-h-[160px]" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} placeholder="Paste the message you received" />
        <button className="btn-primary w-full mt-4" disabled={!message.trim()} onClick={() => { setSession({ ...session, message }); setStarted(true); }}>Start my report</button>
        <p className="mt-4 text-slate-700">If you already lost money or shared a code, <a className="link" href="#/help">get help first</a>. The report can wait.</p>
      </div>
    );
  }

  const q = draft?.questions || [];
  return (
    <div>
      <PageTitle sub="Check each part, fix anything that is wrong, then copy it or open the official page.">Your report</PageTitle>

      <div className="rounded-xl border-2 border-slate-400 bg-white p-4 flex items-start gap-3 mb-6" role="status">
        <Icon name="edit" className="w-6 h-6 mt-1 text-brand" />
        <p><strong>Status: prepared, not submitted.</strong> {draft?.submission.note || 'SafeKaki does not send reports for you. You submit it yourself on the official page.'}</p>
      </div>

      {draft?.urgent && (
        <div className="mb-6"><Callout tone="urgent" title="Protect your money first. The report can wait." icon="alert">
          <ol className="list-decimal pl-6 grid gap-2">{draft.urgentSteps.map((s) => <li key={s}>{s}</li>)}</ol>
          <a href="#/help" className="btn-danger mt-4 w-full sm:w-auto">Open the full help guide</a>
        </Callout></div>
      )}

      {state === 'loading' && !draft && <Spinner label="Preparing your draft…" />}
      {state === 'error' && <ErrorBox message={error} onRetry={() => set('_retry', Date.now())} />}

      {draft && (
        <>
          {q.length > 0 && (
            <fieldset className="rounded-xl border-2 border-brand bg-sky-50 p-5 mb-6 grid gap-6">
              <legend className="px-2 font-bold text-brand">A few quick questions</legend>
              {q.map((x) => (
                <div key={x.key}>
                  {x.type === 'yesno' && (
                    <div role="group" aria-labelledby={`q-${x.key}`}>
                      <p id={`q-${x.key}`} className="font-bold mb-2">{x.question}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <button className="btn-secondary" onClick={() => set(x.key, true)}>Yes</button>
                        <button className="btn-secondary" onClick={() => set(x.key, false)}>No</button>
                      </div>
                    </div>
                  )}
                  {x.type === 'multi' && <SharedInfo q={x} value={details.sharedInfo || []} onChange={(v, none) => setDetails((d) => ({ ...d, sharedInfo: v, sharedInfoNone: none, sharedInfoAnswered: true }))} />}
                  {x.type === 'text' && (
                    <div>
                      <label htmlFor={`q-${x.key}`} className="font-bold block mb-2">{x.question}{x.optional ? ' (optional)' : ''}</label>
                      <input id={`q-${x.key}`} className="field" defaultValue={details[x.key] || ''} onBlur={(e) => e.target.value !== (details[x.key] || '') && set(x.key, e.target.value)} />
                    </div>
                  )}
                </div>
              ))}
            </fieldset>
          )}

          <h2 className="text-lg font-bold mb-3">Review and edit</h2>
          <div className="grid gap-5">
            {fields.map((f) => {
              const id = `f-${f.key}`;
              const long = f.multiline || (f.value || '').length > 70;
              return (
                <div key={f.key}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <label htmlFor={id} className="font-bold">{f.label}</label>
                    <span className={`text-[1.05rem] font-bold ${STATUS_STYLE[f.status]}`}>{STATUS_TEXT[f.status]}</span>
                  </div>
                  {long
                    ? <textarea id={id} className="field mt-1 min-h-[110px]" value={f.value} onChange={(e) => edit(f.key, e.target.value)} />
                    : <input id={id} className="field mt-1" value={f.value} onChange={(e) => edit(f.key, e.target.value)} placeholder="Not provided" />}
                  {f.key === 'description' && (
                    <div className="mt-2"><MicButton onText={(said) => edit('description', f.status === 'provided' && f.value ? `${f.value} ${said}` : said)} /></div>
                  )}
                </div>
              );
            })}
          </div>

          <h2 className="text-lg font-bold mt-8 mb-2">Preview</h2>
          <pre className="whitespace-pre-wrap break-words bg-white border-2 border-slate-300 rounded-xl p-5 text-[1.05rem] leading-relaxed font-sans" tabIndex={0} aria-label="Report preview">{text}</pre>

          <div className="mt-6 grid gap-4">
            <button className="btn-primary" onClick={copy}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied to clipboard' : 'Copy report'}</button>
            {copied && <p role="status" className="font-bold text-safe">Copied. This is still only a draft. It has not been sent to anyone.</p>}

            <div className="rounded-xl border-2 border-slate-400 bg-white p-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="w-7 h-7 mt-1 accent-[#0b4a6f]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I have checked this report. I understand it may include personal details, and that I will submit it myself on the official page.</span>
              </label>
              <h3 className="font-bold mt-5 mb-2">Where to report</h3>
              <ul className="grid gap-4">
                {draft.channels.map((c) => (
                  <li key={c.id}>
                    <p className="font-bold">{c.name}{c.phone ? `: ${c.phone}` : ''}</p>
                    <p className="text-slate-700">{c.note}</p>
                    {c.url && (confirmed
                      ? <a className="btn-secondary mt-2 w-full sm:w-auto" href={c.url} target="_blank" rel="noopener noreferrer">Open official page <Icon name="external" className="w-5 h-5" /></a>
                      : <button className="btn-secondary mt-2 w-full sm:w-auto" disabled>Tick the box above to open this page</button>)}
                    {c.phone && c.id !== 'emergency' && <a className="btn-secondary mt-2 w-full sm:w-auto sm:ml-2" href={`tel:${c.phone}`}><Icon name="phone" className="w-5 h-5" /> Call {c.phone}</a>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SharedInfo({ q, value, onChange }) {
  const toggle = (k) => { const n = value.includes(k) ? value.filter((x) => x !== k) : [...value, k]; onChange(n, false); };
  return (
    <fieldset>
      <legend className="font-bold mb-2">{q.question}</legend>
      <div className="grid gap-2">
        {Object.entries(q.options).map(([k, label]) => (
          <label key={k} className="flex items-center gap-3 rounded-xl border-2 border-slate-300 bg-white p-3 min-h-[56px] cursor-pointer">
            <input type="checkbox" className="w-6 h-6 accent-[#0b4a6f]" checked={value.includes(k)} onChange={() => toggle(k)} />{label}
          </label>
        ))}
        <button className="btn-secondary" onClick={() => onChange([], true)}>I did not share any of these</button>
      </div>
    </fieldset>
  );
}
