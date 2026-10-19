import React, { useEffect, useRef, useState } from 'react';
import { splitRedacted } from '../../shared/redact.js';
import { readScreenshot } from '../api.js';

const PATHS = {
  shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 14-3.5-3.5 1.4-1.4L11 13.2l4.1-4.1 1.4 1.4L11 16Z',
  search: 'M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z',
  flag: 'M5 2v20h2v-7h12l-2-5 2-5H7V2H5Z',
  lifebuoy: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4a6 6 0 0 1 4.2 1.8l-2.1 2.1A3 3 0 0 0 12 9a3 3 0 0 0-2.1.9L7.8 7.8A6 6 0 0 1 12 6Zm-4.2 8.2A6 6 0 0 1 6 12c0-1.6.6-3.1 1.8-4.2l2.1 2.1A3 3 0 0 0 9 12c0 .8.3 1.6.9 2.1l-2.1 2.1Zm4.2 3.8a6 6 0 0 1-4.2-1.8l2.1-2.1c.6.6 1.3.9 2.1.9s1.6-.3 2.1-.9l2.1 2.1A6 6 0 0 1 12 18Zm4.2-3.8-2.1-2.1c.6-.6.9-1.3.9-2.1s-.3-1.6-.9-2.1l2.1-2.1A6 6 0 0 1 18 12c0 1.6-.6 3.1-1.8 4.2Z',
  book: 'M4 4a2 2 0 0 1 2-2h13v17H6a1 1 0 0 0 0 2h13v1H6a3 3 0 0 1-3-3V4h1Zm2 0v13.2c.3-.1.6-.2 1-.2h10V4H6Z',
  alert: 'M12 2 1 21h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z',
  question: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 15h2v2h-2v-2Zm1-11a4 4 0 0 1 1.7 7.6c-.5.3-.7.6-.7 1.4h-2c0-1.6.8-2.3 1.6-2.8A2 2 0 1 0 10 10H8a4 4 0 0 1 4-4Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  phone: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1l-2.2 2.2Z',
  external: 'M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7ZM5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6h-2v6H5V7h6V5H5Z',
  home: 'M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3Z',
  chevron: 'M9 6l6 6-6 6-1.4-1.4L12.2 12 7.6 7.4 9 6Z',
  lock: 'M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 5a3 3 0 1 1 6 0v3H9V6Zm3 7a2 2 0 0 1 1 3.7V19h-2v-2.3A2 2 0 0 1 12 13Z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z',
  stop: 'M6 6h12v12H6z',
  image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5ZM8 9.5A1.5 1.5 0 1 1 8 6.5a1.5 1.5 0 0 1 0 3Z',
  edit: 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3ZM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7Z',
};

export function Icon({ name, className = 'w-6 h-6', label }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 fill-current`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Spinner({ label = 'Working…' }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-4 rounded-xl bg-white border-2 border-slate-300 p-5">
      <svg viewBox="0 0 24 24" className="w-8 h-8 spin text-brand" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 20" strokeLinecap="round" /></svg>
      <span className="font-bold">{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div role="alert" className="rounded-xl border-2 border-scam bg-red-50 p-5">
      <p className="font-bold text-scam flex items-center gap-2"><Icon name="alert" /> That did not work</p>
      <p className="mt-2">{message}</p>
      {onRetry && <button className="btn-secondary mt-4" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Callout({ tone = 'info', title, children, icon }) {
  const tones = {
    info: 'border-brand bg-sky-50',
    urgent: 'border-scam bg-red-50',
    warn: 'border-careful bg-amber-50',
    neutral: 'border-slate-400 bg-white',
  };
  return (
    <div className={`rounded-xl border-2 p-5 ${tones[tone]}`}>
      {title && <p className={`font-bold flex items-center gap-2 ${tone === 'urgent' ? 'text-scam' : tone === 'warn' ? 'text-careful' : 'text-brand'}`}>{icon && <Icon name={icon} />}{title}</p>}
      <div className={title ? 'mt-2' : ''}>{children}</div>
    </div>
  );
}

export function PageTitle({ children, sub }) {
  const ref = React.useRef(null);
  React.useEffect(() => { ref.current?.focus({ preventScroll: false }); }, []);
  return (
    <div className="mb-6">
      <h1 ref={ref} tabIndex={-1} className="text-xl md:text-2xl font-bold text-ink outline-none">{children}</h1>
      {sub && <p className="mt-2 text-slate-700 max-w-prose">{sub}</p>}
    </div>
  );
}

const LEVEL = {
  high_risk: { bar: 'bg-scam', text: 'text-scam', bg: 'bg-red-50', border: 'border-scam', icon: 'alert', label: 'High risk' },
  suspicious: { bar: 'bg-careful', text: 'text-careful', bg: 'bg-amber-50', border: 'border-careful', icon: 'alert', label: 'Suspicious' },
  insufficient_evidence: { bar: 'bg-slate-600', text: 'text-slate-700', bg: 'bg-slate-100', border: 'border-slate-500', icon: 'question', label: 'Not enough evidence' },
};
export const levelStyle = (l) => LEVEL[l] || LEVEL.insufficient_evidence;

// The user's own message with the worrying parts marked inline.
export function MarkedMessage({ text, phrases, level }) {
  const ranges = [];
  for (const p of phrases || []) {
    const pattern = p.text.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const m = new RegExp(pattern, 'i').exec(text);
    if (m) ranges.push([m.index, m.index + m[0].length, p.why]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  const parts = [];
  let i = 0;
  merged.forEach(([s, e, why], k) => {
    if (s > i) parts.push(text.slice(i, s));
    parts.push(<mark key={k} className={`flag ${level === 'high_risk' ? 'hot' : ''}`} title={why}>{text.slice(s, e)}</mark>);
    i = e;
  });
  if (i < text.length) parts.push(text.slice(i));
  return <p className="whitespace-pre-wrap break-words leading-loose bg-white border-2 border-slate-300 rounded-xl p-5">{parts}</p>;
}

/** Shows redacted text with each [NAME 1], [PHONE 1]... as a dark pill. (From the 12 Oct build.) */
export function RedactedText({ text }) {
  return (
    <p className="whitespace-pre-wrap break-words leading-loose bg-white border-2 border-slate-300 rounded-xl p-5">
      {splitRedacted(text).map((part, i) =>
        /^\[.+ \d+\]$/.test(part)
          ? <span key={i} className="mx-0.5 inline-block rounded-md bg-ink px-2 font-bold leading-relaxed text-white">{part.slice(1, -1)}</span>
          : <span key={i}>{part}</span>)}
    </p>
  );
}

/** Speak instead of type, where the browser supports it (Chrome, Edge, Safari). Hidden elsewhere. (From the 12 Oct build.) */
export function MicButton({ onText, disabled }) {
  const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [listening, setListening] = useState(false);
  const rec = useRef(null);
  useEffect(() => () => rec.current?.stop(), []);
  if (!Recognition) return null;
  const toggle = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = new Recognition();
    r.lang = 'en-SG';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      const said = Array.from(e.results).slice(e.resultIndex).map((x) => x[0].transcript).join(' ').trim();
      if (said) onText(said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };
  return (
    <button type="button" className={listening ? 'btn-danger' : 'btn-secondary'} onClick={toggle} aria-pressed={listening} disabled={disabled}>
      <Icon name={listening ? 'stop' : 'mic'} /> {listening ? 'Stop listening' : 'Speak instead'}
    </button>
  );
}

// ---- Screenshots ----
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('read_failed'));
  r.readAsDataURL(file);
});
// Big phone screenshots are shrunk in the browser before upload (faster, and stays under the 8 MB limit).
async function shrinkIfLarge(file) {
  if (file.size <= 3 * 1024 * 1024 || typeof createImageBitmap !== 'function') return fileToDataUrl(file);
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  } catch { return fileToDataUrl(file); }
}

/** Reads the words out of a screenshot file. Resolves to { text, method } or throws an Error with a friendly message. */
export async function screenshotToText(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) throw new Error('Please choose a PNG or JPG screenshot.');
  if (file.size > 20 * 1024 * 1024) throw new Error('That picture is too big. Please use a smaller screenshot.');
  const dataUrl = await shrinkIfLarge(file);
  const r = await readScreenshot(dataUrl);
  return { text: r.text, method: r.method };
}

/** "Upload a screenshot" button. Calls onText(text, method) with the words it read. (Paste an image into a text box also works, see onPasteImage.) */
export function ScreenshotButton({ onText, onError, onBusy, disabled }) {
  const input = useRef(null);
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onBusy?.(true);
    try { const r = await screenshotToText(file); onText(r.text, r.method); }
    catch (err) { onError?.(err.message); }
    finally { onBusy?.(false); }
  }
  return (
    <>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={pick} data-testid="screenshot-input" />
      <button type="button" className="btn-secondary" onClick={() => input.current?.click()} disabled={disabled}><Icon name="image" /> Upload a screenshot</button>
    </>
  );
}

/** onPaste handler for a textarea: if the clipboard holds an image, read it like an uploaded screenshot. */
export function onPasteImage({ onText, onError, onBusy }) {
  return async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => IMAGE_TYPES.includes(i.type));
    if (!item) return; // normal text paste
    e.preventDefault();
    onBusy?.(true);
    try { const r = await screenshotToText(item.getAsFile()); onText(r.text, r.method); }
    catch (err) { onError?.(err.message); }
    finally { onBusy?.(false); }
  };
}
