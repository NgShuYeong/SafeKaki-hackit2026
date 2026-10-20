// Hides private details (names, phone numbers, NRIC, cards, bank accounts, OTPs,
// emails, addresses) before a scam message is shared with family or others.
// Brought over from the 12 Oct SafeAlerts build ("Share a scam safely").
//
// Pure rules, no network: runs in the browser, the server and the Telegram bot.
// An optional AI pass (server/core/redactNames.js) can find names the rules miss;
// it only ever sees text these rules have already cleaned, so numbers never leave.
//
// Links (https://...) are deliberately KEPT: a scam link is the evidence other
// people need to recognise the same scam.

const LABELS = {
  name: 'NAME',
  phone: 'PHONE',
  nric: 'NRIC',
  email: 'EMAIL',
  card: 'CARD',
  bank: 'BANK ACCT',
  otp: 'CODE',
  address: 'ADDRESS',
}

// Official numbers people should still be able to see.
const SAFE_NUMBERS = new Set(['999', '995', '1799', '18002550000', '1800 255 0000'])

// Capitalised words that look like names after "Hi"/"Dear" but are not people.
const NOT_NAMES = new Set([
  'sir', 'madam', 'maam', 'customer', 'customers', 'valued', 'user', 'all', 'there',
  'everyone', 'friend', 'friends', 'dear', 'team', 'bank', 'police', 'singapore',
  'good', 'morning', 'afternoon', 'evening', 'uncle', 'auntie', 'aunty', 'boss',
  'bro', 'sis', 'darling', 'dear', 'mum', 'mom', 'dad', 'ma', 'pa', 'grandma',
  'grandpa', 'ah', 'congratulations', 'urgent', 'important', 'notice', 'reminder',
  'whatsapp', 'telegram', 'carousell', 'shopee', 'lazada', 'singpass', 'scamshield',
])

const PATTERNS = [
  // name@example.com
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  // S1234567D, T0123456A, also partly masked forms like SXXXX567D
  ['nric', /\b[STFGM][0-9Xx*]{4}\d{3}[A-Z]\b/gi],
  // 4111 1111 1111 1111
  ['card', /\b(?:\d[ -]?){12,18}\d\b/g],
  // 123-45678-9, 001-234567-8
  ['bank', /\b\d{3}-\d{5,6}-\d{1,3}\b/g],
  // OTP / PIN / code followed by 4-8 digits
  ['otp', /\b(?:OTP|PIN|TAC|code|passcode|verification code)(?:\s*(?:is|:|=|-))?\s*(\d{4,8})\b/gi],
  // +65 9123 4567, 6512 3456, +60 12-345 6789, +86 138 0013 8000
  ['phone', /\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,4}\b/g], // international, starts with +
  ['phone', /\b(?:65[\s-]?)?[3689]\d{3}[\s-]?\d{4}\b/g],                // Singapore 8-digit
  ['phone', /\b\d{3,4}[\s-]\d{3,4}[\s-]\d{3,4}\b/g],                    // other spaced numbers
  // Blk 123 Ang Mo Kio Ave 3 #05-67, Singapore 560123
  ['address', /\b(?:Blk|Block)\s*\d+[A-Z]?\b[^\n,.]*?(?:#\d{1,3}-\d{1,5})?(?=[,.\n]|$)/gi],
  ['address', /#\d{1,3}-\d{1,5}\b/g],
  ['address', /\b(?:Singapore|S)\s?\(?\d{6}\)?/g],
]

const NAME_WORD = "[A-Z][a-z'’-]+"
const FULL_NAME = `${NAME_WORD}(?:\\s+${NAME_WORD}){0,2}`
const NAME_PATTERNS = [
  // Mr Tan, Mdm Lim Siew Hua, Officer David Lee, Inspector Wong
  new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Mdm|Madam|Dr|Officer|Inspector|Insp|Sgt|Sergeant|Uncle|Auntie|Aunty)\\.?\\s+(${FULL_NAME})`, 'g'),
  // Hi John, / Dear Mary Tan! / Hello Ahmad
  new RegExp(`\\b(?:Hi|Hello|Hey|Dear)\\s+(${FULL_NAME})(?=\\s*[,!.:\\n]|$)`, 'g'),
  // my name is Kelly Ng / I'm called Jason
  new RegExp(`\\b(?:[Mm]y name is|[Nn]ame's|I am called|I'm called|[Cc]all me)\\s+(${FULL_NAME})`, 'g'),
  // - Jason / Regards, Kelly (sign-offs at the end of a line)
  new RegExp(`(?:Regards|Thanks|Thank you|Best|Cheers|From)\\s*,?\\s*\\n?\\s*(${FULL_NAME})\\s*$`, 'gm'),
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function digitsOf(s) {
  return s.replace(/\D/g, '')
}

/**
 * Rule-based redaction. Instant and works offline.
 * @param {string} text
 * @param {{ extraNames?: string[] }} opts  names the user wants hidden (e.g. their own)
 * @returns {{ text: string, items: {type:string, original:string, label:string}[] }}
 */
export function redactLocal(text, opts = {}) {
  const items = []
  const seen = new Map() // original -> label, so the same number gets the same label
  const counts = {}

  const labelFor = (type, original) => {
    const key = type + '|' + original.trim().toLowerCase()
    if (seen.has(key)) return seen.get(key)
    counts[type] = (counts[type] || 0) + 1
    const label = `[${LABELS[type]} ${counts[type]}]`
    seen.set(key, label)
    items.push({ type, original: original.trim(), label })
    return label
  }

  let out = text

  for (const [type, re] of PATTERNS) {
    out = out.replace(re, (match, group) => {
      if (type === 'phone' || type === 'card') {
        const d = digitsOf(match)
        if (SAFE_NUMBERS.has(d) || SAFE_NUMBERS.has(match.trim())) return match
        if (type === 'phone' && (d.length < 8 || d.length > 15)) return match
        // A year range or a price such as 2024 2025 is not a phone number.
        if (type === 'phone' && /^(19|20)\d{2}\s(19|20)\d{2}$/.test(match.trim())) return match
      }
      if (type === 'otp') {
        // Keep the word "OTP", hide only the digits.
        return match.replace(group, labelFor('otp', group))
      }
      // Keep any leading space the phone pattern may have swallowed.
      const lead = match.match(/^\s*/)[0]
      return lead + labelFor(type, match.slice(lead.length))
    })
  }

  out = replaceNames(out, findNamesByRules(out), labelFor)
  if (opts.extraNames?.length) {
    out = replaceNames(out, opts.extraNames.map((n) => n.trim()).filter(Boolean), labelFor)
  }

  return { text: out, items }
}

function findNamesByRules(text) {
  const found = new Set()
  for (const re of NAME_PATTERNS) {
    for (const m of text.matchAll(re)) {
      // Trim words that are clearly not part of a name, but only at the edges:
      // "Dear Customer Tan" -> "Tan", while "Tan Ah Kow" keeps its "Ah".
      const words = m[1].split(/\s+/)
      const isNot = (w) => NOT_NAMES.has(w.toLowerCase())
      // "Ah" starts many Singapore names (Ah Huat, Ah Lian), so keep it when a name follows.
      while (words.length && isNot(words[0]) && !(words[0].toLowerCase() === 'ah' && words.length > 1)) words.shift()
      while (words.length && isNot(words[words.length - 1])) words.pop()
      const name = words.join(' ')
      if (name && !NOT_NAMES.has(name.toLowerCase())) found.add(name)
    }
  }
  return [...found]
}

function replaceNames(text, names, labelFor) {
  // Longest first, so "Tan Ah Kow" is replaced before "Tan".
  const sorted = [...new Set(names)].filter((n) => n.length > 1).sort((a, b) => b.length - a.length)
  let out = text
  for (const name of sorted) {
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, 'g')
    if (re.test(out)) out = out.replace(re, () => labelFor('name', name))
  }
  return out
}

/** Counts hidden items in plain words, e.g. "2 phone numbers, 1 name". */
const TYPE_WORDS = {
  name: ['name', 'names'], phone: ['phone number', 'phone numbers'], nric: ['NRIC', 'NRICs'],
  email: ['email', 'emails'], card: ['card number', 'card numbers'], bank: ['bank account', 'bank accounts'],
  otp: ['code', 'codes'], address: ['address', 'addresses'],
}
export function describeHidden(items) {
  const counts = {}
  for (const i of items) counts[i.type] = (counts[i.type] || 0) + 1
  return Object.entries(counts).map(([t, n]) => `${n} ${TYPE_WORDS[t][n === 1 ? 0 : 1]}`).join(', ')
}

/** Splits redacted text into plain and [LABEL n] parts, for highlighting in the UI. */
export function splitRedacted(text) {
  const types = Object.values(LABELS).map(escapeRe).join('|')
  return text.split(new RegExp(`(\\[(?:${types}) \\d+\\])`, 'g')).filter(Boolean)
}
