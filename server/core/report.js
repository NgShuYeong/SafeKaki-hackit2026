// Report drafting. Nothing is ever invented: every field is marked
// provided (typed by user), extracted (found in the message), unconfirmed (suggested) or missing.
import { preprocess } from './preprocess.js';
import { detectVictimState } from './heuristics.js';
import { RESOURCES, SCAM_CATEGORIES, CATEGORY_LABELS, RISK_LABELS } from '../../shared/resources.js';
import { REPORT_FIELDS, formatReportText } from '../../shared/formatReport.js';

export const SHARED_INFO_OPTIONS = {
  otp: 'OTP / SMS code',
  password: 'Password or PIN',
  card: 'Card number or CVV',
  singpass: 'SingPass login',
  nric: 'NRIC number',
  other: 'Other personal details',
};

const tri = (v) => (v === true || v === 'yes' ? true : v === false || v === 'no' ? false : null);
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function normaliseDetails(d = {}) {
  const shared = Array.isArray(d.sharedInfo) ? d.sharedInfo.filter((k) => k in SHARED_INFO_OPTIONS) : [];
  return {
    sender: clip(d.sender, 200),
    incidentTime: clip(d.incidentTime, 100),
    description: clip(d.description, 1500),
    clickedLink: tri(d.clickedLink),
    sharedInfo: shared,
    sharedInfoAnswered: d.sharedInfoAnswered === true || shared.length > 0 || d.sharedInfoNone === true,
    sharedInfoNone: d.sharedInfoNone === true,
    moneyLost: tri(d.moneyLost),
    amountLost: clip(d.amountLost, 40),
    otherEvidence: clip(d.otherEvidence, 800),
    category: SCAM_CATEGORIES.includes(d.category) ? d.category : null,
    riskLevel: ['high_risk', 'suspicious', 'insufficient_evidence'].includes(d.riskLevel) ? d.riskLevel : null,
    forwardedFrom: clip(d.forwardedFrom, 200),
  };
}

export function buildReportDraft({ message, details = {} }) {
  const pre = preprocess(message || '');
  if (!pre.ok) return { ok: false, error: pre.error, code: 'invalid_input' };
  const d = normaliseDetails(details);
  const said = detectVictimState(pre.original);

  const f = {};
  const set = (key, value, status) => { f[key] = { key, value, status: value ? status : 'missing' }; };

  set('category', d.category ? CATEGORY_LABELS[d.category] + (d.riskLevel ? ` (SafeKaki rating: ${RISK_LABELS[d.riskLevel]})` : '') : '', 'unconfirmed');
  set('originalMessage', pre.original, 'provided');

  if (d.sender) set('sender', d.sender, 'provided');
  else if (d.forwardedFrom) set('sender', `${d.forwardedFrom} (name shown on the forwarded message)`, 'unconfirmed');
  else {
    const bits = [...pre.phones, ...pre.emails];
    set('sender', bits.length ? `Contact details mentioned in the message: ${bits.join(', ')}` : '', 'unconfirmed');
  }
  set('urls', pre.urls.join('\n'), 'extracted');
  set('incidentTime', d.incidentTime, 'provided');

  if (d.description) set('description', d.description, 'provided');
  else set('description', 'I received the message above. I have not confirmed who sent it.', 'unconfirmed');

  const clicked = d.clickedLink ?? (said.clickedLink ? true : null);
  set('clickedLink', clicked === null ? '' : clicked ? 'Yes' : 'No', d.clickedLink !== null ? 'provided' : 'unconfirmed');

  const sharedFromText = [said.sharedOtp && 'otp', said.sharedCredentials && 'password'].filter(Boolean);
  const sharedList = d.sharedInfo.length ? d.sharedInfo : d.sharedInfoNone ? [] : sharedFromText;
  const sharedText = sharedList.length ? sharedList.map((k) => SHARED_INFO_OPTIONS[k]).join(', ') : d.sharedInfoNone ? 'None' : '';
  set('sharedInfo', sharedText, d.sharedInfo.length || d.sharedInfoNone ? 'provided' : 'unconfirmed');

  const money = d.moneyLost ?? (said.transferredMoney ? true : null);
  set('moneyLost', money === null ? '' : money ? 'Yes' : 'No', d.moneyLost !== null ? 'provided' : 'unconfirmed');
  set('amountLost', money === false ? '' : d.amountLost, 'provided');
  if (money === false) f.amountLost = { key: 'amountLost', value: 'Not applicable', status: 'provided' };
  set('otherEvidence', d.otherEvidence, 'provided');

  const fields = REPORT_FIELDS.map((def) => ({ ...f[def.key], label: def.label, multiline: !!def.multiline }));

  // Only ask for what is genuinely needed.
  const questions = [];
  const missing = (k) => f[k].status === 'missing';
  if (money === null) questions.push({ key: 'moneyLost', type: 'yesno', question: 'Did you transfer any money?' });
  if (money === true && missing('amountLost')) questions.push({ key: 'amountLost', type: 'text', question: 'About how much did you transfer (in SGD)?' });
  if (!d.sharedInfoAnswered && sharedFromText.length === 0) questions.push({ key: 'sharedInfo', type: 'multi', question: 'Did you share any of these with the sender?', options: SHARED_INFO_OPTIONS });
  if (clicked === null && pre.urls.length) questions.push({ key: 'clickedLink', type: 'yesno', question: 'Did you click the link?' });
  if (missing('incidentTime')) questions.push({ key: 'incidentTime', type: 'text', question: 'When did this happen? (date and time, a rough guess is fine)', optional: true });

  const urgent = money === true || sharedList.some((k) => ['otp', 'password', 'card', 'singpass'].includes(k));
  const channels = urgent ? [RESOURCES.bank, RESOURCES.helpline, RESOURCES.policeReport] : [RESOURCES.scamshield, RESOURCES.helpline];
  if (!urgent && money === null) channels.push(RESOURCES.policeReport);

  const createdAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return {
    ok: true,
    report: {
      status: 'prepared', // never "submitted": SafeKaki cannot submit on the user's behalf
      submitted: false,
      submission: {
        method: 'manual',
        note: 'This report has been prepared only. SafeKaki has not sent it to the police, ScamShield or any bank. There is no official API for direct submission, so you submit it yourself using the official channels below.',
      },
      urgent,
      urgentSteps: urgent ? [
        'Call your bank now (number on your card or in its official app) and ask them to freeze or block your account and card.',
        'Change passwords for your banking and email.',
        'Then file the police report. This draft will save you time.',
      ] : [],
      fields,
      missingKeys: fields.filter((x) => x.status === 'missing').map((x) => x.key),
      questions,
      channels,
      text: formatReportText(fields, { createdAt }),
      createdAt,
    },
  };
}
