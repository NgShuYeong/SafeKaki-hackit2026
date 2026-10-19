// The ONE analysis pipeline used by the web API and the Telegram bot.
import { preprocess } from './preprocess.js';
import { detectSignals, detectVictimState } from './heuristics.js';
import { callLlm, llmConfigured, LlmError } from './llm.js';
import { buildUserPrompt } from './prompt.js';
import { RESOURCES, SCAM_CATEGORIES, CATEGORY_LABELS } from '../../shared/resources.js';

const ORDER = { insufficient_evidence: 0, suspicious: 1, high_risk: 2 };
const LEVELS = Object.keys(ORDER);
const moreSevere = (a, b) => (ORDER[a] >= ORDER[b] ? a : b);
const oneStepDown = (l) => (l === 'high_risk' ? 'suspicious' : 'insufficient_evidence');

export const DISCLAIMER = 'AI checks can be wrong. If you are unsure, call the ScamShield Helpline at 1799 (free, 24/7).';

const HEADLINES = {
  high_risk: 'High risk: this message has strong signs of a scam',
  suspicious: 'Be careful: this message has warning signs',
  insufficient_evidence: 'Not enough evidence to judge. This does not mean it is safe',
};

function norm(s) { return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim(); }

// Keep only quoted phrases that really exist in the original. Never show invented quotes.
function verifyPhrases(original, items) {
  const flat = original.replace(/\s+/g, ' ');
  const flatLower = flat.toLowerCase();
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const text = (it?.text || '').toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 200) continue;
    const i = flatLower.indexOf(text.toLowerCase());
    if (i < 0) continue; // not in the original, so never shown
    const exact = flat.slice(i, i + text.length);
    const key = exact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: exact, why: (it.why || '').toString().slice(0, 160) });
  }
  return out;
}

function sanitizeLlm(raw) {
  const level = LEVELS.includes(raw?.riskLevel) ? raw.riskLevel : null;
  if (!level) throw new LlmError('bad_response');
  const strArr = (a, max, len = 220) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).slice(0, max).map((x) => x.trim().slice(0, len)) : []);
  return {
    riskLevel: level,
    confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'low',
    scamCategory: SCAM_CATEGORIES.includes(raw.scamCategory) ? raw.scamCategory : 'unclear',
    plainEnglish: typeof raw.plainEnglish === 'string' ? raw.plainEnglish.trim().slice(0, 400) : '',
    languageNotes: typeof raw.languageNotes === 'string' ? raw.languageNotes.trim().slice(0, 300) : '',
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 400) : '',
    reasons: strArr(raw.reasons, 6),
    suspiciousPhrases: Array.isArray(raw.suspiciousPhrases) ? raw.suspiciousPhrases.slice(0, 8) : [],
    missingInfo: strArr(raw.missingInfo, 3),
  };
}

function guessCategory(signals, pre) {
  const ids = new Set(signals.signals.map((s) => s.id));
  const t = pre.original.toLowerCase();
  if (/\b(?:parcel|package|delivery|courier|singpost|dhl|ninja)\b/.test(t)) return 'parcel_or_delivery';
  if (ids.has('threat_legal') || /\b(?:police|mas|ica|iras|moh|mom|court|officer)\b/.test(t)) return 'government_official_impersonation';
  if (ids.has('remote_access')) return 'tech_support_or_remote_access';
  if (/\b(?:bank|dbs|posb|ocbc|uob|card|account|acct|otp|singpass)\b/.test(t)) return 'bank_or_card_phishing';
  if (/\b(?:invest|crypto|bitcoin|usdt|returns?)\b/.test(t)) return 'investment_or_crypto';
  if (ids.has('too_good')) return /\bjob|earn|commission\b/.test(t) ? 'job_or_commission' : 'prize_or_refund';
  if (ids.has('unknown_contact')) return 'romance_or_friend_impersonation';
  return 'unclear';
}

export function buildNextSteps(level, victim, category) {
  const steps = [];
  if (level === 'insufficient_evidence') {
    steps.push('Do not click links or share codes until you are sure who sent this.');
    steps.push('If it claims to be from a bank or agency, contact them yourself using the number in their official app or on your card.');
    steps.push('Not sure? Call the ScamShield Helpline 1799 and they will help you check.');
    return steps;
  }
  steps.push('Do not click any link, open any attachment or call any number in the message.');
  steps.push('Never share OTPs, PINs or passwords. Real banks and agencies never ask for them by message or call.');
  if (category === 'bank_or_card_phishing' || category === 'unclear') steps.push('Check your account by opening your bank\'s official app yourself, not through the message.');
  if (category === 'parcel_or_delivery') steps.push('Check the courier\'s official app or website by typing the address yourself.');
  if (category === 'government_official_impersonation') steps.push('Government officers do not ask you to transfer money or keep a case secret. Hang up and call the agency using its official number.');
  steps.push('Report the message through the ScamShield app, then block the sender.');
  steps.push('Not sure? Call the ScamShield Helpline 1799.');
  return steps;
}

export function buildUrgentGuidance(victim) {
  if (!victim?.any && !victim?.clickedLink) return null;
  const actions = [];
  if (victim.transferredMoney) actions.push('Call your bank now using the number on the back of your card or in its official app. Ask them to stop or recall the transfer and freeze your account.');
  if (victim.sharedOtp || victim.sharedCredentials) actions.push('Call your bank now to block your card or online banking. Then change your passwords, starting with your banking and email.');
  if (victim.clickedLink && !victim.any) actions.push('Do not enter anything on that page. If you already typed a password or code, treat it as shared and call your bank.');
  actions.push('You can also call the ScamShield Helpline 1799 (24/7). It can connect you to your bank, but it cannot file a police report for you.');
  if (victim.transferredMoney || victim.sharedCredentials || victim.sharedOtp) actions.push('Then file a police report online. Do this after you have called the bank, not before.');
  const reasons = [];
  if (victim.transferredMoney) reasons.push('money may have been transferred');
  if (victim.sharedOtp) reasons.push('an OTP or code may have been shared');
  if (victim.sharedCredentials) reasons.push('login or card details may have been shared');
  if (victim.clickedLink) reasons.push('a link may have been opened');
  return { active: true, title: 'Act now: protect your money first', because: reasons, actions, resources: [RESOURCES.bank, RESOURCES.helpline, RESOURCES.policeReport] };
}

/**
 * @param {{message:string, forwardedFrom?:string, userContext?:object}} input
 * @param {{llm?:Function, cfg?:object}} deps  llm can be injected for tests
 */
export async function analyzeMessage(input, deps = {}) {
  const t0 = Date.now();
  const pre = preprocess(input.message, { forwardedFrom: input.forwardedFrom });
  if (!pre.ok) return { ok: false, error: pre.error, code: 'invalid_input' };

  const signals = detectSignals(pre.original, pre);
  const victimFromText = detectVictimState(pre.original);
  const ctx = input.userContext || {};
  const victim = {
    sharedOtp: victimFromText.sharedOtp || !!ctx.sharedOtp,
    sharedCredentials: victimFromText.sharedCredentials || !!ctx.sharedCredentials,
    transferredMoney: victimFromText.transferredMoney || !!ctx.transferredMoney,
    clickedLink: victimFromText.clickedLink || !!ctx.clickedLink,
  };
  victim.any = victim.sharedOtp || victim.sharedCredentials || victim.transferredMoney;

  let llm = null;
  let llmError = null;
  const call = deps.llm || ((p) => callLlm(p, { cfg: deps.cfg }));
  const canCall = deps.llm ? true : llmConfigured(deps.cfg);
  if (canCall) {
    try {
      llm = sanitizeLlm(await call(buildUserPrompt({ pre, signals, victimState: victim, userContext: ctx })));
    } catch (e) {
      llmError = e instanceof LlmError ? e.code : 'unknown';
    }
  } else {
    llmError = 'not_configured';
  }

  // ---- merge ----
  let level;
  const reasons = [];
  let summary = '';
  const notes = [];
  if (llm) {
    const floor = oneStepDown(signals.level);
    level = moreSevere(llm.riskLevel, floor);
    if (level !== llm.riskLevel) notes.push('Our rule checks found stronger warning signs than the AI summary, so the risk level was raised to be safe.');
    reasons.push(...llm.reasons);
    for (const s of signals.signals) if (s.hard || s.id === 'lookalike_url') if (!reasons.some((r) => norm(r).includes(norm(s.label).slice(0, 18)))) reasons.push(s.label);
    summary = llm.summary;
  } else {
    level = signals.level;
    reasons.push(...signals.signals.map((s) => s.label));
    notes.push('The AI service was not available, so this result uses basic rule checks only. It may miss things. Treat it as a rough guide.');
  }
  if (victim.any) level = moreSevere(level, 'suspicious');
  if (!summary) {
    summary = level === 'insufficient_evidence'
      ? 'We did not find clear warning signs in this text, but a short or incomplete message cannot be judged for sure.'
      : 'This message contains patterns often used in scams. Treat it with caution until you have checked with the real organisation.';
  }
  if (level === 'insufficient_evidence' && reasons.length === 0) reasons.push('No clear warning signs were found in the text. We cannot check who really sent it or where a link leads.');

  const phrases = verifyPhrases(pre.original, [
    ...(llm?.suspiciousPhrases || []),
    ...signals.signals.flatMap((s) => s.phrases.map((p) => ({ text: p, why: s.label }))),
  ]).slice(0, 8);

  const category = llm?.scamCategory && llm.scamCategory !== 'unclear' ? llm.scamCategory : level === 'insufficient_evidence' ? (llm?.scamCategory || 'unclear') : guessCategory(signals, pre);
  const missingInfo = llm?.missingInfo?.length ? llm.missingInfo : level === 'insufficient_evidence' ? ['Who sent it, and how did it reach you?', 'Where does the link go (do not open it to find out)?'] : [];

  return {
    ok: true,
    analysis: {
      riskLevel: level,
      headline: HEADLINES[level],
      summary,
      confidence: llm?.confidence || 'low',
      reasons: reasons.slice(0, 8),
      suspiciousPhrases: phrases,
      scamCategory: category,
      scamCategoryLabel: CATEGORY_LABELS[category],
      interpretation: {
        plainEnglish: llm?.plainEnglish || '',
        languageNotes: llm?.languageNotes || '',
        singlishTermsSpotted: pre.singlishTerms.map((t) => t.term),
      },
      links: pre.urlAnalysis.map((u) => ({ link: u.raw, host: u.host, warnings: u.flags })),
      extracted: { urls: pre.urls, phones: pre.phones, emails: pre.emails, amounts: pre.amounts, forwardedFrom: pre.forwardedFrom },
      missingInfo,
      nextSteps: buildNextSteps(level, victim, category),
      urgent: buildUrgentGuidance(victim),
      victimState: victim,
      notes,
      disclaimer: DISCLAIMER,
      original: pre.original, // always returned untouched so reports use the real text
    },
    meta: { source: llm ? 'ai+rules' : 'rules_only', degraded: !llm, llmError, truncated: pre.truncated, ms: Date.now() - t0 },
  };
}
