// Turns the shared analysis/report objects into Telegram HTML messages.
import { RESOURCES, RISK_LABELS } from '../shared/resources.js';
import { describeHidden, redactLocal } from '../shared/redact.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON = { high_risk: '🔴', suspicious: '🟠', insufficient_evidence: '🟡' };

export function formatAnalysis(a, { degraded } = {}) {
  const out = [];
  if (a.urgent) {
    out.push(`🚨 <b>${esc(a.urgent.title)}</b>`);
    a.urgent.actions.forEach((x, i) => out.push(`${i + 1}. ${esc(x)}`));
    out.push('');
  }
  out.push(`${ICON[a.riskLevel]} <b>${esc(a.headline)}</b>`, '', esc(a.summary));
  if (a.interpretation?.plainEnglish) out.push('', `<i>In plain English: ${esc(a.interpretation.plainEnglish)}</i>`);
  if (a.reasons.length) { out.push('', '<b>Why</b>'); a.reasons.slice(0, 4).forEach((r) => out.push(`• ${esc(r)}`)); }
  if (a.suspiciousPhrases.length) { out.push('', '<b>Parts that worry me</b>'); a.suspiciousPhrases.slice(0, 4).forEach((p) => out.push(`• "${esc(p.text)}"`)); }
  const riskyLinks = a.links.filter((l) => l.warnings.length);
  if (riskyLinks.length) { out.push('', '<b>Links (do not open)</b>'); riskyLinks.slice(0, 3).forEach((l) => out.push(`• ${esc(l.host)}: ${esc(l.warnings[0])}`)); }
  if (!a.urgent) { out.push('', '<b>What to do</b>'); a.nextSteps.slice(0, 4).forEach((s) => out.push(`• ${esc(s)}`)); }
  if (a.missingInfo.length && a.riskLevel === 'insufficient_evidence') { out.push('', '<b>What would help</b>'); a.missingInfo.slice(0, 2).forEach((m) => out.push(`• ${esc(m)}`)); }
  if (degraded || a.notes.length) a.notes.forEach((n) => out.push('', `ℹ️ ${esc(n)}`));
  out.push('', `<i>${esc(a.disclaimer)}</i>`);
  return out.join('\n');
}

export function formatReportPreview(report) {
  const lines = ['📝 <b>Your report draft</b>', ''];
  lines.push(`<b>Status: prepared, NOT submitted.</b> ${esc(report.submission.note)}`, '');
  if (report.missingKeys.length) {
    const labels = report.fields.filter((f) => report.missingKeys.includes(f.key)).map((f) => f.label);
    lines.push(`<b>Still missing:</b> ${labels.map(esc).join('; ')}`, '');
  }
  lines.push('Copy the text below (press and hold, then Copy):', '', `<pre>${esc(report.text)}</pre>`);
  return lines.join('\n');
}

export function channelButtons(channels) {
  return channels.filter((c) => c.url).map((c) => [{ text: c.name.slice(0, 60), url: c.url }]);
}

export function channelText(channels) {
  const lines = ['<b>Where to report</b>'];
  for (const c of channels) {
    const how = c.phone ? ` Call ${esc(c.phone)}.` : '';
    lines.push(`• <b>${esc(c.name)}</b>.${how} ${esc(c.note)}`);
  }
  return lines.join('\n');
}

export const WELCOME = `👋 Hello! I'm <b>SafeKaki</b>, your scam-check buddy.

Send me a suspicious message and I'll tell you if it has warning signs. You can paste it, forward it, or send a 📷 screenshot of it. English, Singlish and mixed languages are fine.

What I can do:
• Check a message: just send it (text or screenshot)
• /report: prepare a scam report
• /share: hide names and numbers so you can warn your family
• /scammed: urgent help if you already shared a code or sent money
• /tips: how to spot common scams
• /privacy: what happens to your messages

I cannot be 100% sure about any message. When in doubt, call the ScamShield Helpline <b>1799</b> (free, 24/7).`;

export const PRIVACY = `🔒 <b>Your privacy</b>

• Your message is sent to our server and to the AI service that helps read it.
• It is not saved in a database. I keep it in memory for up to 30 minutes only so I can help you prepare a report, then delete it. /cancel deletes it right away.
• Our logs record that a request happened, never what your message said.
• Please do not send passwords, PINs or OTPs to me. If a message contains them, hide them first.
• I never contact the police, banks or ScamShield for you. Reports are prepared for you to submit yourself.
• Telegram itself can see your chat with me. Delete the chat if you want it gone.`;

export const TIPS = `🛡️ <b>Spot a scam</b>

• Real banks, police and government agencies never ask for your OTP, PIN or password.
• Be careful if a message is urgent, scary, or says you will be blocked, fined or arrested.
• Never click links in unexpected messages. Open the official app or type the website yourself.
• Nobody legitimate asks you to move money to a "safe account".
• Be careful if someone asks you to install an app or share your screen.
• A "new number" message from family? Call their old number first.
• Too good to be true (easy money, prizes, guaranteed returns)? It usually is.

Report scam messages through the <b>ScamShield</b> app (${esc(RESOURCES.scamshield.url)}) and call <b>1799</b> if you are unsure.`;

export const NEED_MESSAGE = 'Please paste or forward the suspicious message to me, or send a screenshot of it.';
export const TEXT_ONLY = 'I can read text and screenshots (PNG or JPG). Voice notes, videos and stickers are not supported yet. Please paste the words, or send a screenshot of the message.';
export const READING_IMAGE = '📷 Reading your screenshot…';
export const formatReadText = (text, method) => `📷 <b>Here is what I read from your screenshot</b>${method === 'ocr' ? ' (if something looks wrong, paste the text instead)' : ''}:\n\n<pre>${esc(text)}</pre>`;
export const LLM_DOWN_NOTE = 'I could not reach the AI service, so I used basic checks only.';
export const GENERIC_ERROR = 'Sorry, something went wrong on my side. Please try again in a moment. If it is urgent, call the ScamShield Helpline 1799.';
export const riskLabel = (l) => RISK_LABELS[l];

// "Warn family safely" (from the 12 Oct build): private details hidden, ready to forward.
export function formatShare(result, analysis) {
  const head = analysis && analysis.riskLevel !== 'insufficient_evidence'
    ? `Scam warning (${analysis.riskLevel === 'high_risk' ? 'high risk' : 'suspicious'}): ${redactLocal(analysis.headline).text}`
    : 'Be careful, I got this message and I think it may be a scam:';
  const family = `${head}\n\n"${result.text}"\n\nDo not click any links or reply. If you are not sure, call the ScamShield Helpline 1799.`;
  const lines = [
    '🔒 <b>Safe to share</b>',
    result.items.length ? `I hid: ${esc(describeHidden(result.items))}.` : 'I did not find any private details.',
    'Links are kept so others can recognise the same scam. Please read it once more before you send it.',
    '',
    'Copy this and send it to your family (press and hold, then Copy):',
    '',
    `<pre>${esc(family)}</pre>`,
  ];
  return lines.join('\n');
}
