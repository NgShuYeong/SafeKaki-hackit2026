// "Warn family safely": hide names, phone numbers, NRIC, cards, bank accounts, OTPs, emails and
// addresses before a scam message is passed on. Brought over from the 12 Oct SafeAlerts build.
//
// Step 1 (rules) runs right here in the browser, so numbers never leave the device.
// Step 2 (optional) asks the server's AI for names the rules missed, sending only the cleaned text.
import React, { useState } from 'react';
import { findNamesToHide } from '../api.js';
import { describeHidden, redactLocal } from '../../shared/redact.js';
import { Callout, ErrorBox, Icon, MicButton, PageTitle, RedactedText, ScreenshotButton, Spinner, onPasteImage } from '../components/ui.jsx';

const MAX = 4000;

function familyMessage(safeText, analysis) {
  const head = analysis && analysis.riskLevel !== 'insufficient_evidence'
    ? `Scam warning (${analysis.riskLevel === 'high_risk' ? 'high risk' : 'suspicious'}): ${redactLocal(analysis.headline).text}`
    : 'Be careful, I got this message and I think it may be a scam:';
  return `${head}\n\n"${safeText}"\n\nDo not click any links or reply. If you are not sure, call the ScamShield Helpline 1799.`;
}

export default function Share({ session }) {
  const [text, setText] = useState(session.message || '');
  const [myNames, setMyNames] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [copied, setCopied] = useState('');
  const [reading, setReading] = useState(false);
  const [shotError, setShotError] = useState('');
  const shot = {
    onText: (t) => { setText(t.slice(0, MAX)); setResult(null); setReading(false); setShotError(''); },
    onError: (msg) => { setShotError(msg); setReading(false); },
    onBusy: (b) => { setReading(b); if (b) setShotError(''); },
  };

  async function run() {
    setBusy(true); setShowHidden(false); setCopied('');
    const extraNames = myNames.split(',').map((n) => n.trim()).filter(Boolean);
    const first = redactLocal(text, { extraNames });
    let aiNames = [], aiNote = 'rules';
    try {
      const r = await findNamesToHide(first.text);
      aiNames = r.names || [];
      aiNote = r.usedAI ? 'ai' : 'rules';
    } catch { aiNote = 'offline'; }
    setResult({ ...(aiNames.length ? redactLocal(text, { extraNames: [...extraNames, ...aiNames] }) : first), aiNote });
    setBusy(false);
  }

  async function copy(value, which) {
    try { await navigator.clipboard.writeText(value); }
    catch { const ta = document.createElement('textarea'); ta.value = value; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); }
    setCopied(which);
  }

  const forFamily = result && familyMessage(result.text, session.message === text ? session.analysis : null);

  return (
    <div>
      <PageTitle sub="We hide names, phone numbers and other private details, so you can warn family and friends without exposing anyone.">Warn family safely</PageTitle>

      <label htmlFor="share-text" className="block font-bold mb-2">The message</label>
      <textarea id="share-text" className="field min-h-[160px]" value={text} maxLength={MAX}
        onChange={(e) => { setText(e.target.value); setResult(null); }} onPaste={onPasteImage(shot)} placeholder="Paste or type the scam message here, or a screenshot" disabled={busy || reading} />

      <label htmlFor="share-names" className="block font-bold mt-4 mb-2">
        Any other names to hide? <span className="font-normal text-slate-700">(optional, e.g. your own name)</span>
      </label>
      <input id="share-names" className="field" value={myNames} onChange={(e) => { setMyNames(e.target.value); setResult(null); }} placeholder="Tan Ah Kow, Mei Ling" disabled={busy} />

      <div className="mt-4 flex flex-col sm:flex-row gap-3">
        <button className="btn-primary flex-1" onClick={run} disabled={!text.trim() || busy || reading}><Icon name="lock" /> Hide private info</button>
        <ScreenshotButton {...shot} disabled={busy || reading} />
        <MicButton disabled={busy || reading} onText={(said) => { setText((t) => (t ? `${t} ${said}` : said).slice(0, MAX)); setResult(null); }} />
      </div>

      <div className="mt-6" aria-live="polite">
        {reading && <Spinner label="Reading the words in your screenshot…" />}
        {shotError && !reading && <ErrorBox message={shotError} />}
        {busy && <Spinner label="Hiding private details…" />}
      </div>

      {result && !busy && (
        <section className="grid gap-5" aria-labelledby="share-h">
          <Callout tone="info" icon="check" title={result.items.length ? `Hidden: ${describeHidden(result.items)}` : 'We did not find any private details'}>
            <p id="share-h">Links are kept on purpose, so others can recognise the same scam.
              {result.aiNote === 'ai' ? ' Please read it once more before you send it.' : ' Please read it once more in case we missed a name.'}</p>
          </Callout>

          <RedactedText text={result.text} />

          {result.items.length > 0 && (
            <div>
              <button className="btn-quiet !px-0" onClick={() => setShowHidden((s) => !s)} aria-expanded={showHidden}>
                {showHidden ? 'Hide the list' : 'Show me what was hidden (only you can see this)'}
              </button>
              {showHidden && (
                <ul className="mt-2 grid gap-1">
                  {result.items.map((i) => <li key={i.label}><strong>{i.label.slice(1, -1)}</strong>: {i.original}</li>)}
                </ul>
              )}
            </div>
          )}

          <div>
            <h2 className="text-lg font-bold mb-2">Message for your family</h2>
            <pre className="whitespace-pre-wrap break-words bg-white border-2 border-slate-300 rounded-xl p-5 leading-relaxed font-sans" tabIndex={0} aria-label="Message for your family">{forFamily}</pre>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <a className="btn-primary" href={`https://wa.me/?text=${encodeURIComponent(forFamily)}`} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Send on WhatsApp</a>
            <button className="btn-secondary" onClick={() => copy(forFamily, 'family')}><Icon name={copied === 'family' ? 'check' : 'copy'} /> {copied === 'family' ? 'Copied' : 'Copy family message'}</button>
            <button className="btn-secondary" onClick={() => copy(result.text, 'safe')}><Icon name={copied === 'safe' ? 'check' : 'copy'} /> {copied === 'safe' ? 'Copied' : 'Copy safe version only'}</button>
            {!session.analysis && <a className="btn-quiet" href="#/check">Check this message first</a>}
          </div>
        </section>
      )}
    </div>
  );
}
