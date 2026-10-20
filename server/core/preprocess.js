// Preprocessing: clean input, extract entities, flag Singlish terms.
// IMPORTANT: the original message is never replaced. We only add hints around it.
// URLs are parsed as text only. Nothing here ever fetches or visits a link.

export const MAX_MESSAGE_CHARS = 4000;

// Singlish / local terms the LLM and UI can use as interpretation hints.
// Presence of these words is NOT a scam signal.
export const SINGLISH_GLOSSARY = {
  lah: 'sentence-ending particle for emphasis or softening',
  leh: 'sentence-ending particle, often mild protest or suggestion',
  lor: 'sentence-ending particle meaning "that is how it is"',
  anot: '"or not?" at the end of a question (e.g. "can anot?")',
  meh: 'sentence-ending particle expressing doubt',
  sia: 'sentence-ending particle for emphasis',
  kena: 'passive marker: "got/suffered" (e.g. "kena locked" = got locked; "kena scam" = got scammed)',
  alamak: 'exclamation of dismay',
  aiyo: 'exclamation of dismay',
  aiya: 'exclamation of dismay or impatience',
  paiseh: 'embarrassed / sorry to trouble you',
  bo: '"don\'t have" (Hokkien)',
  jialat: 'in serious trouble / terrible',
  chope: 'reserve (a seat)',
  confirm: 'definitely (as in "confirm can")',
  can: 'okay / possible, also used as a complete reply',
  cannot: 'not possible / not allowed',
  eh: 'attention-getter',
  bro: 'informal address to a male friend',
  sis: 'informal address to a female friend',
  wah: 'exclamation of surprise',
  walao: 'exclamation of frustration',
  bojio: 'did not invite me',
  makan: 'eat',
  shiok: 'very satisfying',
  siao: 'crazy',
  tio: 'got hit / won / matched',
  dun: 'don\'t (informal)',
  pls: 'please',
  plz: 'please',
  acct: 'account',
  tmr: 'tomorrow',
  asap: 'as soon as possible',
};

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeInput(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Message must be text.' };
  let t = raw.replace(CONTROL, '').replace(ZERO_WIDTH, '').replace(/\r\n?/g, '\n');
  t = t.trim();
  if (!t) return { ok: false, error: 'Please paste a message first.' };
  const truncated = t.length > MAX_MESSAGE_CHARS;
  if (truncated) t = t.slice(0, MAX_MESSAGE_CHARS);
  return { ok: true, text: t, truncated };
}

// --- URL extraction -------------------------------------------------------
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63})*\.(?:com|net|org|sg|info|biz|xyz|top|icu|cfd|sbs|click|vip|work|buzz|live|site|online|link|app|co|io|me|cc|ly|gl|to|tk|ml|ga|cf|gq|shop|store|cn|ru|test)\b(?:\/[^\s<>"')\]]*)?/gi;
const FILE_LIKE = /\.(?:png|jpe?g|gif|pdf|docx?|xlsx?|txt|mp[34]|zip)$/i;

export function extractUrls(text) {
  const found = new Set();
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0].replace(/[.,;:!?]+$/, '');
    if (FILE_LIKE.test(raw)) continue;
    // skip email domains
    const idx = m.index;
    if (idx > 0 && text[idx - 1] === '@') continue;
    const key = raw.toLowerCase();
    if (found.has(key)) continue;
    found.add(key);
    out.push(raw);
  }
  return out;
}

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.ly', 'cutt.ly', 'rb.gy', 'is.gd', 'goo.gl', 'ow.ly', 'shorturl.at', 's.id', 'tiny.cc', 'rebrand.ly', 'buff.ly', 'bl.ink', 'lnkd.in', 'wa.link', 't.co']);
const RISKY_TLDS = new Set(['xyz', 'top', 'icu', 'cfd', 'sbs', 'click', 'vip', 'work', 'buzz', 'tk', 'ml', 'ga', 'cf', 'gq', 'cc', 'link', 'site', 'online', 'shop', 'store', 'test']); // .test = safe demo links (reserved, never a real website), scored like a scam ending

// brand keyword -> legitimate registrable domains
const BRANDS = {
  dbs: ['dbs.com', 'dbs.com.sg'], posb: ['posb.com.sg', 'dbs.com.sg'], ocbc: ['ocbc.com', 'ocbc.com.sg'],
  uob: ['uob.com.sg', 'uobgroup.com'], singpass: ['singpass.gov.sg'], singpost: ['singpost.com'],
  iras: ['iras.gov.sg'], cpf: ['cpf.gov.sg'], ica: ['ica.gov.sg'], hdb: ['hdb.gov.sg'], mas: ['mas.gov.sg'],
  paynow: [], grab: ['grab.com'], shopee: ['shopee.sg', 'shopee.com'], lazada: ['lazada.sg', 'lazada.com'],
  dhl: ['dhl.com'], ninjavan: ['ninjavan.co'], singtel: ['singtel.com'], starhub: ['starhub.com'],
  citibank: ['citibank.com.sg', 'citi.com'], hsbc: ['hsbc.com.sg', 'hsbc.com'], maybank: ['maybank.com.sg', 'maybank.com'],
  standardchartered: ['sc.com'], apple: ['apple.com'], netflix: ['netflix.com'], paypal: ['paypal.com'],
};

export function analyseUrl(raw) {
  const flags = [];
  let host = '';
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    host = u.hostname.toLowerCase();
    if (u.protocol === 'http:' && /^https?:\/\//i.test(raw)) flags.push('Uses unencrypted http');
  } catch {
    return { raw, host: '', flags: ['Link looks malformed'], owner: 'unknown' };
  }
  const parts = host.split('.');
  const tld = parts[parts.length - 1];
  const isGov = host.endsWith('.gov.sg') || host === 'gov.sg';
  if (SHORTENERS.has(host)) flags.push('Shortened link hides its real destination');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.push('Uses a raw IP address instead of a name');
  if (host.includes('xn--')) flags.push('Uses look-alike (punycode) characters');
  if (tld === 'test') flags.push('Uses a .test demo link (treated like a risky scam ending)');
  else if (RISKY_TLDS.has(tld)) flags.push(`Uses the .${tld} ending, which is often used in scams`);
  if ((host.match(/-/g) || []).length >= 2) flags.push('Domain has many hyphens');
  if (parts.length >= 5) flags.push('Domain has many sub-parts');

  let owner = 'unknown';
  const compact = host.replace(/[-.]/g, '');
  for (const [brand, legit] of Object.entries(BRANDS)) {
    if (!compact.includes(brand)) continue;
    const isLegit = legit.some((d) => host === d || host.endsWith('.' + d)) || (brand === 'iras' || brand === 'cpf' || brand === 'ica' || brand === 'hdb' || brand === 'mas' || brand === 'singpass') && isGov;
    if (isLegit) { owner = brand; break; }
    flags.push(`Name contains "${brand.toUpperCase()}" but is not an official ${brand.toUpperCase()} domain`);
    owner = 'lookalike';
    break;
  }
  if (isGov && owner === 'unknown') owner = 'gov.sg';
  return { raw, host, flags, owner };
}

// --- other entities -------------------------------------------------------
export function extractPhones(text) {
  const set = new Set();
  // SG 8-digit numbers starting 3/6/8/9, optionally +65, and +country codes
  for (const m of text.matchAll(/(?:\+|00)\d{1,3}[\s-]?\d{6,12}\b|\b(?:\+?65[\s-]?)?[3689]\d{3}[\s-]?\d{4}\b/g)) {
    const v = m[0].trim();
    if (/^\d{4}[\s-]?\d{4}$/.test(v) && /^(19|20)\d{2}/.test(v)) continue; // looks like a year range
    set.add(v);
  }
  return [...set];
}

export function extractEmails(text) {
  return [...new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []))];
}

export function extractAmounts(text) {
  const set = new Set();
  for (const m of text.matchAll(/(?:S?\$|SGD\s?|USD\s?)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?[kK])?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars?|SGD|bucks)\b/g)) set.add(m[0].trim());
  return [...set];
}

export function detectSinglish(text) {
  const lower = text.toLowerCase();
  const hits = [];
  for (const [term, meaning] of Object.entries(SINGLISH_GLOSSARY)) {
    // 'can' / 'confirm' are common English words; only count them with a stronger Singlish context
    if (['can', 'confirm', 'bo', 'dun', 'tio', 'eh'].includes(term)) continue;
    const re = new RegExp(`(?<![a-z])${term}(?![a-z])`, 'i');
    if (re.test(lower)) hits.push({ term, meaning });
  }
  return hits;
}

export function preprocess(rawMessage, { forwardedFrom } = {}) {
  const s = sanitizeInput(rawMessage);
  if (!s.ok) return s;
  const urls = extractUrls(s.text);
  return {
    ok: true,
    original: s.text, // never modified beyond cleanup of control characters
    truncated: s.truncated,
    urls,
    urlAnalysis: urls.map(analyseUrl),
    phones: extractPhones(s.text),
    emails: extractEmails(s.text),
    amounts: extractAmounts(s.text),
    singlishTerms: detectSinglish(s.text),
    forwardedFrom: forwardedFrom || null,
  };
}
