// Rule-based scam signals. Two jobs:
//  1. Give the LLM concrete, verifiable hints (signals found in the text).
//  2. Provide a degraded-but-honest fallback if the LLM is unavailable.
// Singlish particles (lah, leh, lor, anot...) are NOT signals here.

const NEG_BEFORE = /(?:do not|don't|dont|never|jangan|won't|will not|not)\W+(?:\w+\W+){0,3}$/i;

function negated(text, index) {
  const before = text.slice(Math.max(0, index - 40), index);
  return NEG_BEFORE.test(before);
}

function findAll(text, re, { skipNegated = false } = {}) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of text.matchAll(g)) {
    if (skipNegated && negated(text, m.index)) continue;
    out.push(m[0].trim());
  }
  return out;
}

const SECRET = '(?:otp|one[- ]?time (?:password|pin|code)|verification code|auth(?:entication)? code|6[- ]?digit (?:code|number)|tac|mpin|pin|password|passcode|cvv|cvc|security code|card number|login details|log-?in details|internet banking (?:id|login|details)|singpass (?:password|pin|login))';

const SIGNALS = [
  {
    id: 'secret_request', weight: 5, hard: true,
    label: 'Asks you to hand over an OTP, PIN, password or card details',
    patterns: [
      new RegExp(`\\b(?:need|require|want|send|give|share|provide|tell|reply(?: with)?|key in|enter|confirm|read out|forward|submit|show|what(?:'s| is))\\b[^.!?\\n]{0,45}?\\b${SECRET}\\b`, 'i'),
      /\b(?:send|tell|give|share|read|forward)\b[^.!?\n]{0,20}\b(?:the |your )?(?:code|number)\b[^.!?\n]{0,25}\b(?:sms|received|you got|just sent|we sent)\b/i,
      /(?:提供|告诉|告訴|发给|發給|输入|輸入|发送|發送)[^。.!?\n]{0,10}(?:验证码|驗證碼|密码|密碼|短信码|OTP)/i,
      /\b(?:masukkan|berikan|hantar|beritahu)\b[^.!?\n]{0,20}\b(?:otp|kata laluan|pin|tac)\b/i,
    ],
    skipNegated: true,
  },
  {
    id: 'remote_access', weight: 5, hard: true,
    label: 'Asks you to install an app or give remote access',
    patterns: [/\b(?:anydesk|teamviewer|quicksupport|ultraviewer|rustdesk)\b/i, /\b[\w-]+\.apk\b/i, /\b(?:install|download)\b[^.!?\n]{0,30}\b(?:app|apk|software|file)\b[^.!?\n]{0,30}\b(?:verify|secure|protect|fix|support|help)\b/i, /\bscreen[- ]?shar(?:e|ing)\b/i],
  },
  {
    id: 'threat_account', weight: 3,
    label: 'Threatens that your account, card or parcel will be blocked, locked or held',
    patterns: [
      /\b(?:account|acct|card|parcel|package|number|singpass|line|wallet|delivery)\b[^.!?\n]{0,30}?\b(?:will be|is|has been|been|kena|got|gets?|already)\s+(?:locked|blocked|suspended|frozen|terminated|deactivated|stuck|held|restricted|compromised|cancelled|closed|returned)\b/i,
      /\b(?:or|otherwise|else)\b[^.!?\n]{0,30}\b(?:blocked|suspended|locked|frozen|terminated|closed|cancelled)\b/i,
      /(?:户口|戶口|账户|賬戶|账号|帐户|银行卡|銀行卡)[^。.!?\n]{0,12}(?:冻结|凍結|封锁|封鎖|停用|暂停|暫停|被锁|被鎖)/,
      /\b(?:akaun|kad)\b[^.!?\n]{0,25}\b(?:disekat|dibekukan|digantung|ditutup|dibatalkan)\b/i,
    ],
  },
  {
    id: 'threat_legal', weight: 4,
    label: 'Threatens arrest, court action or a criminal case',
    patterns: [/\b(?:arrest(?:ed)?|warrant|summons|money laundering|criminal (?:case|charge)|legal action|prosecut\w+|jail|police case|court (?:case|order|hearing))\b/i],
  },
  {
    id: 'urgency', weight: 2,
    label: 'Pushes you to act immediately',
    patterns: [
      /\b(?:immediately|urgent(?:ly)?|asap|right away|without delay|act now|last (?:warning|chance|notice|reminder)|final notice|expires?(?: today| soon| in \d+\w*)?|within \d+\s*(?:hours?|hrs?|mins?|minutes?|days?))\b/i,
      /\bpay\b[^.!?\n]{0,15}\bnow\b/i,
      /(?:马上|馬上|立即|立刻|尽快|盡快|紧急|緊急)/,
      /\b(?:segera|dengan segera|sekarang juga)\b/i,
      /\bnow\s+(?:lah|or)\b[^.!?\n]{0,40}\b(?:blocked|suspended|locked|terminated)\b/i,
    ],
  },
  {
    id: 'click_link', weight: 2,
    label: 'Tells you to click or open a link',
    patterns: [
      /\b(?:click|tap|open|visit|follow|go to|log ?in(?: at| via| here)?|verify|update|release|claim|confirm)\b[^.!?\n]{0,40}\b(?:link|url|here|below|website|site|portal|https?:\/\/\S+|www\.\S+)/i,
      /(?:点击|點擊|点按|打开|打開)[^。.!?\n]{0,8}(?:链接|鏈接|连结|連結|网址|網址)/,
      /\b(?:klik|tekan|buka)\b[^.!?\n]{0,20}\b(?:pautan|link|laman)\b/i,
    ],
  },
  {
    id: 'payment_request', weight: 3,
    label: 'Asks you to pay or transfer money',
    patterns: [
      /\b(?:need to|must|have to|should|please|kindly|required to|got to|will need to|can you(?: help me)?|could you(?: help me)?)\s+(?:pay|transfer|remit|top ?up|deposit|send (?:money|\$))\b/i,
      /\b(?:processing|admin|handling|customs|release|clearance|redelivery|insurance|unlock) fee\b/i,
      /\b(?:safe account|holding account|gift ?cards?|itunes card|google play card|bitcoin|usdt|crypto(?:currency)?)\b/i,
      /\btransfer\b[^.!?\n]{0,30}\bto\b[^.!?\n]{0,30}\b(?:account|acct|paynow|number)\b/i,
      /(?:转账|轉賬|汇款|匯款|付款)[^。.!?\n]{0,10}(?:到|至|给|給)/,
    ],
  },
  {
    id: 'impersonation', weight: 2,
    label: 'Claims to be from a bank, agency, courier or company',
    patterns: [/\b(?:i(?:'m| am)|this is|we are|we're|calling from|message from|msg from|officer from|staff (?:of|from)|from the)\b[^.!?\n]{0,30}\b(?:bank|dbs|posb|ocbc|uob|citibank|hsbc|maybank|police|spf|mas|iras|ica|cpf|singpass|singpost|dhl|ninja ?van|lazada|shopee|grab|singtel|starhub|m1|customs|court|moh|mom|customer service|customer support|tech support|security (?:team|department))\b/i],
  },
  {
    id: 'secrecy', weight: 3,
    label: 'Tells you to keep it secret',
    patterns: [/\b(?:don't|do not|dont|never)\s+(?:tell|inform|let|share this with)\b[^.!?\n]{0,30}\b(?:anyone|family|bank|friends?|police|children|son|daughter|wife|husband)\b/i, /\b(?:keep|stay)\b[^.!?\n]{0,20}\b(?:confidential|secret|quiet)\b/i],
  },
  {
    id: 'too_good', weight: 2,
    label: 'Offers a prize, refund or unusually easy money',
    patterns: [/\b(?:you(?:'ve| have)? (?:won|been selected)|lucky draw|congratulations|claim your (?:prize|reward|refund)|guaranteed (?:returns?|profit)|risk[- ]free|easy money|earn\s*\$?\d+[^.!?\n]{0,15}(?:per|a|\/)\s*(?:day|hour)|part[- ]?time job|work from home|tax refund|unclaimed)\b/i],
  },
  {
    id: 'easy_income', weight: 3,
    label: 'Promises easy money for simple online tasks',
    patterns: [
      /\bearn\s*(?:up to\s*)?\$?\d+[^.!?\n]{0,20}(?:per|a|\/)\s*(?:day|hour|hr)\b/i,
      /\$\s?\d+\s*(?:per|a|\/)\s*(?:day|hour)\b/i,
      /\b(?:like and follow|like & follow|rating tasks?|boost(?:ing)? (?:sales|ratings)|task commission|top[- ]?up tasks?)\b/i,
    ],
  },
  {
    id: 'unknown_contact', weight: 1,
    label: 'Contact from someone claiming a new number or unknown identity asking for help',
    patterns: [/\b(?:this is my new number|changed (?:my )?number|new number)\b/i, /\bhi (?:mum|mom|dad|mummy|papa)\b/i],
  },
];

function levelFromScore(score, hardHit, distinct) {
  if ((hardHit && score >= 5 && distinct >= 2) || score >= 8) return 'high_risk';
  if (hardHit || score >= 3) return 'suspicious';
  return 'insufficient_evidence';
}

/**
 * @param {string} text original message
 * @param {object} pre output of preprocess()
 */
export function detectSignals(text, pre = {}) {
  const found = [];
  for (const s of SIGNALS) {
    const phrases = [];
    for (const re of s.patterns) phrases.push(...findAll(text, re, { skipNegated: s.skipNegated }));
    if (phrases.length) found.push({ id: s.id, label: s.label, weight: s.weight, hard: !!s.hard, phrases: [...new Set(phrases)].slice(0, 4) });
  }
  // Link-based signals
  for (const u of pre.urlAnalysis || []) {
    if (u.owner === 'lookalike') found.push({ id: 'lookalike_url', label: `Link imitates a known brand: ${u.host}`, weight: 4, hard: false, phrases: [u.raw] });
    else if (u.flags.length) found.push({ id: 'risky_url', label: `Link looks risky: ${u.flags[0].toLowerCase()}`, weight: 2, hard: false, phrases: [u.raw] });
  }
  const dedup = new Map();
  for (const f of found) if (!dedup.has(f.id) || f.weight > dedup.get(f.id).weight) dedup.set(f.id, f);
  const signals = [...dedup.values()];
  const score = signals.reduce((a, s) => a + s.weight, 0);
  const hardHit = signals.some((s) => s.hard);
  return { signals, score, level: levelFromScore(score, hardHit, signals.length) };
}

// Did the USER say they've already been harmed? (their own words, e.g. "I already gave the OTP")
export function detectVictimState(text) {
  const t = text.toLowerCase();
  const past = '(?:already|just|earlier|alr|liao|)';
  const sharedOtp = /\b(?:i|we)\b[^.!?\n]{0,30}\b(?:gave|give|given|shared|share|sent|send|told|keyed in|key in|entered|provided)\b[^.!?\n]{0,25}\b(?:otp|code|tac|pin)\b/.test(t) || /\b(?:otp|code|tac)\b[^.!?\n]{0,20}\b(?:already|alr|liao)\b[^.!?\n]{0,15}\b(?:gave|give|given|shared|sent)\b/.test(t);
  const sharedCreds = /\b(?:i|we)\b[^.!?\n]{0,20}\b(?:gave|give|given|shared|sent|keyed in|key in|entered|provided|logged in|log in)\b[^.!?\n]{0,25}\b(?:password|login|singpass|card number|cvv|banking details|internet banking|details)\b/.test(t);
  const transferred = /\b(?:i|we)\b[^.!?\n]{0,40}\b(?:transferred|transfered|paid|sent|send|remitted|topped up|go transfer|already transfer|made a transfer|wired)\b[^.!?\n]{0,25}(?:money|\$|sgd|\d{2,}|them|him|her|account|paynow)/.test(t) || /\bmoney\b[^.!?\n]{0,15}\b(?:gone|stolen|lost|scammed)\b/.test(t) || /\b(?:lost|scammed of)\b[^.!?\n]{0,10}\$\s?\d/.test(t);
  const clicked = /\b(?:i|we)\b[^.!?\n]{0,20}\b(?:clicked|click(?:ed)? on|tapped|opened|pressed)\b[^.!?\n]{0,20}\b(?:link|it|that|the link)\b/.test(t) || /\balready\s+(?:click|clicked|open|opened)\b/.test(t);
  return { sharedOtp, sharedCredentials: sharedCreds, transferredMoney: transferred, clickedLink: clicked, any: sharedOtp || sharedCreds || transferred };
}
