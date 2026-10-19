import { envStatus } from '../server/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBackend } from './backend.js';
import { createLimiter } from '../server/core/ratelimit.js';
import { buildUrgentGuidance } from '../server/core/analyze.js';
import { SHARED_INFO_OPTIONS } from '../server/core/report.js';
import { RESOURCES } from '../shared/resources.js';
import * as F from './format.js';
import { redactLocal } from '../shared/redact.js';

const STATE_TTL_MS = 30 * 60 * 1000;
const COMMANDS = [
  { command: 'start', description: 'Say hello' },
  { command: 'report', description: 'Prepare a scam report' },
  { command: 'share', description: 'Hide names and numbers so you can warn family' },
  { command: 'scammed', description: 'Urgent help: I already shared a code or sent money' },
  { command: 'tips', description: 'How to spot scams' },
  { command: 'privacy', description: 'What happens to my messages' },
  { command: 'cancel', description: 'Delete what you sent me and start over' },
];

export function createBot({ token, backend = makeBackend(), fetchImpl = fetch, apiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org', allowedUserIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean), ratePerMin = Number(process.env.BOT_RATE_LIMIT_PER_MIN) || 8, log = console.log } = {}) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  // Two limits: "checks" are actions that analyse a message (and may cost AI money);
  // "taps" are cheap button presses and plain chat, with a much higher limit just to stop spam.
  const limiter = createLimiter({ windowMs: 60_000, max: ratePerMin });
  const tapLimiter = createLimiter({ windowMs: 60_000, max: Math.max(60, ratePerMin * 6) });
  async function tooFast(chatId, userId, lim = limiter) {
    const rl = lim.check(`u:${userId}`);
    if (rl.allowed) return false;
    await send(chatId, `You are going a bit fast. Please wait ${rl.retryAfterSec} seconds and try again.`);
    return true;
  }
  const states = new Map(); // chatId -> { message, analysis, details, skipped:Set, mode, pending, ts }

  // ---- Telegram API (official Bot API over HTTPS) ----
  async function tg(method, payload = {}) {
    const res = await fetchImpl(`${apiBase}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(payload.timeout ? (payload.timeout + 15) * 1000 : 20000) });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) { const e = new Error(`telegram_${data.error_code || res.status}`); e.retryAfter = data.parameters?.retry_after; e.code = data.error_code; throw e; }
    return data.result;
  }
  async function send(chatId, text, extra = {}) {
    const chunks = [];
    let rest = text;
    while (rest.length > 3900) { let cut = rest.lastIndexOf('\n', 3900); if (cut < 1000) cut = 3900; chunks.push(rest.slice(0, cut)); rest = rest.slice(cut); }
    chunks.push(rest);
    for (let i = 0; i < chunks.length; i++) {
      // A split <pre> block would break HTML, so only the last chunk gets the keyboard and we balance tags.
      let c = chunks[i];
      if (chunks.length > 1) { const opens = (c.match(/<pre>/g) || []).length, closes = (c.match(/<\/pre>/g) || []).length; if (opens > closes) c += '</pre>'; if (closes > opens) c = '<pre>' + c; }
      try {
        await tg('sendMessage', { chat_id: chatId, text: c, parse_mode: 'HTML', disable_web_page_preview: true, ...(i === chunks.length - 1 ? extra : {}) });
      } catch (e) {
        log(`send failed: ${e.message}`);
        if (e.code === 400) await tg('sendMessage', { chat_id: chatId, text: c.replace(/<[^>]+>/g, ''), ...(i === chunks.length - 1 ? { reply_markup: extra.reply_markup } : {}) }).catch(() => {});
      }
    }
  }
  const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });

  // ---- state ----
  function getState(chatId) {
    const s = states.get(chatId);
    if (s && Date.now() - s.ts > STATE_TTL_MS) { states.delete(chatId); return null; }
    return s || null;
  }
  function touch(chatId, patch) {
    const s = getState(chatId) || { message: null, analysis: null, details: {}, skipped: new Set(), mode: null, pending: null, ts: Date.now() };
    Object.assign(s, patch, { ts: Date.now() });
    states.set(chatId, s);
    return s;
  }
  const sweep = setInterval(() => { for (const [k, v] of states) if (Date.now() - v.ts > STATE_TTL_MS) states.delete(k); }, 5 * 60 * 1000);
  sweep.unref?.();

  // ---- features ----
  async function analyseAndReply(chatId, userId, text, forwardedFrom) {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    let r;
    try { r = await backend.analyze({ message: text, forwardedFrom, clientId: userId }); } catch { r = null; }
    if (!r) return send(chatId, F.GENERIC_ERROR);
    if (!r.ok) return send(chatId, r.code === 'rate_limited' || r.code === 'busy' ? esc2(r.error) : r.code === 'invalid_input' ? esc2(r.error) : F.GENERIC_ERROR);
    const a = r.analysis;
    touch(chatId, { message: a.original, analysis: a, details: { category: a.scamCategory, riskLevel: a.riskLevel, forwardedFrom: forwardedFrom || '', clickedLink: a.victimState.clickedLink ? true : undefined }, skipped: new Set(), mode: null, pending: null });
    const rows = [[{ text: '📝 Prepare a report', callback_data: 'rp:start' }], [{ text: '🔒 Warn family safely', callback_data: 'sh:go' }]];
    if (!a.urgent) rows.push([{ text: '🚨 I already shared info or sent money', callback_data: 'urgent:menu' }]);
    await send(chatId, F.formatAnalysis(a, { degraded: r.meta?.degraded }), kb(rows));
  }
  const esc2 = F.esc;

  async function shareSafely(chatId, userId, text, analysis) {
    // Rules run here first, so only cleaned text ever reaches the optional AI name check.
    let result = redactLocal(text);
    try {
      const r = await backend.findNames({ text: result.text, clientId: userId });
      if (r?.ok && r.names?.length) result = redactLocal(text, { extraNames: r.names });
    } catch { /* rules-only result is fine */ }
    return send(chatId, F.formatShare(result, analysis));
  }

  async function urgentMenu(chatId) {
    await send(chatId, '🚨 <b>If you already acted, speed matters.</b>\nTell me what happened and I will give you the most important steps first. You do not need to complete a report before you act.', kb([
      [{ text: '💸 I transferred money', callback_data: 'urgent:money' }],
      [{ text: '🔑 I shared an OTP, password or card details', callback_data: 'urgent:creds' }],
      [{ text: '🔗 I clicked a link', callback_data: 'urgent:link' }],
    ]));
  }
  async function urgentReply(chatId, kind) {
    const victim = { any: kind !== 'link', transferredMoney: kind === 'money', sharedOtp: kind === 'creds', sharedCredentials: kind === 'creds', clickedLink: kind === 'link' };
    const g = buildUrgentGuidance(victim);
    const lines = [`🚨 <b>${F.esc(g.title)}</b>`, ''];
    g.actions.forEach((x, i) => lines.push(`${i + 1}. ${F.esc(x)}`));
    lines.push('', F.channelText(g.resources));
    const s = getState(chatId);
    touch(chatId, { details: { ...(s?.details || {}), ...(kind === 'money' ? { moneyLost: true } : {}), ...(kind === 'creds' ? { sharedInfo: ['otp', 'password'] } : {}), ...(kind === 'link' ? { clickedLink: true } : {}) } });
    await send(chatId, lines.join('\n'), kb([...F.channelButtons(g.resources), [{ text: '📝 Prepare my report (after you call the bank)', callback_data: 'rp:start' }]]));
  }

  async function nextReportStep(chatId) {
    const s = getState(chatId);
    if (!s?.message) { touch(chatId, { mode: 'await_message_for_report' }); return send(chatId, F.NEED_MESSAGE); }
    const r = await backend.draft({ message: s.message, details: s.details, clientId: String(chatId) });
    if (!r.ok) return send(chatId, F.GENERIC_ERROR);
    const q = r.report.questions.find((x) => !s.skipped.has(x.key));
    if (!q) return showReport(chatId, r.report);
    touch(chatId, { pending: q, mode: q.type === 'text' ? 'await_text_answer' : null });
    const skip = q.optional || q.type === 'text' ? [{ text: 'Skip', callback_data: `skip:${q.key}` }] : [];
    if (q.type === 'yesno') return send(chatId, `❓ ${F.esc(q.question)}`, kb([[{ text: 'Yes', callback_data: `yn:${q.key}:1` }, { text: 'No', callback_data: `yn:${q.key}:0` }], skip].filter((r) => r.length)));
    if (q.type === 'multi') return sendMulti(chatId, q);
    return send(chatId, `❓ ${F.esc(q.question)}\nType your answer, or tap Skip.`, kb([skip]));
  }
  async function sendMulti(chatId, q) {
    const s = getState(chatId);
    const chosen = new Set(s?.details?.sharedInfo || []);
    const rows = Object.entries(SHARED_INFO_OPTIONS).map(([k, label]) => [{ text: `${chosen.has(k) ? '✅' : '⬜'} ${label}`, callback_data: `si:${k}` }]);
    rows.push([{ text: 'Done', callback_data: 'si:done' }, { text: 'I shared nothing', callback_data: 'si:none' }]);
    await send(chatId, `❓ ${F.esc(q.question)}\nTap all that apply, then Done.`, kb(rows));
  }
  async function showReport(chatId, report) {
    touch(chatId, { pending: null, mode: null });
    if (report.urgent) await send(chatId, '🚨 <b>Before anything else:</b>\n' + report.urgentSteps.map((x, i) => `${i + 1}. ${F.esc(x)}`).join('\n'));
    await send(chatId, F.formatReportPreview(report));
    await send(chatId, F.channelText(report.channels) + '\n\nTap a button to open the official page. Submit the report there yourself.', kb([
      ...F.channelButtons(report.channels),
      [{ text: '✏️ Add what happened', callback_data: 'ed:description' }, { text: '✏️ Add sender', callback_data: 'ed:sender' }],
    ]));
  }

  // ---- screenshots ----
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  function imageOf(m) {
    if (Array.isArray(m.photo) && m.photo.length) {
      const best = [...m.photo].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]; // biggest size is easiest to read
      return { fileId: best.file_id, size: best.file_size };
    }
    if (m.document && /^image\/(png|jpe?g|webp)$/i.test(m.document.mime_type || '')) return { fileId: m.document.file_id, size: m.document.file_size };
    return null;
  }
  async function downloadFile(fileId) {
    const f = await tg('getFile', { file_id: fileId });
    if (!f?.file_path) throw new Error('no_file_path');
    if (f.file_size && f.file_size > MAX_IMAGE_BYTES) { const e = new Error('too_large'); e.tooLarge = true; throw e; }
    const res = await fetchImpl(`${apiBase}/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`download_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) { const e = new Error('too_large'); e.tooLarge = true; throw e; }
    return buf;
  }
  async function readScreenshot(chatId, userId, image) {
    if (image.size && image.size > MAX_IMAGE_BYTES) { await send(chatId, 'That picture is too big. Please send a smaller screenshot (under 8 MB).'); return null; }
    await send(chatId, F.READING_IMAGE);
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    let buf;
    try { buf = await downloadFile(image.fileId); }
    catch (e) { await send(chatId, e.tooLarge ? 'That picture is too big. Please send a smaller screenshot (under 8 MB).' : 'Sorry, I could not download that picture from Telegram. Please try sending it again.'); return null; }
    let r;
    try { r = await backend.readImage({ image: buf, clientId: userId }); } catch { r = null; }
    buf = null; // the image is not kept
    if (!r?.ok) { await send(chatId, F.esc(r?.error || 'Sorry, I could not read that picture. Please try a clearer screenshot, or paste the text.')); return null; }
    await send(chatId, F.formatReadText(r.text, r.method));
    return r.text;
  }

  // ---- update handling ----
  function forwardName(m) {
    const o = m.forward_origin;
    if (o) return o.sender_user ? [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(' ') + (o.sender_user.username ? ` (@${o.sender_user.username})` : '') : o.sender_user_name || o.chat?.title || o.sender_chat?.title || '';
    if (m.forward_from) return [m.forward_from.first_name, m.forward_from.last_name].filter(Boolean).join(' ');
    return m.forward_sender_name || m.forward_from_chat?.title || '';
  }

  async function onMessage(m) {
    const chatId = m.chat.id;
    const userId = m.from?.id;
    if (m.chat.type !== 'private' || m.from?.is_bot) return; // private chats only, no groups
    if (allowedUserIds.length && !allowedUserIds.includes(String(userId))) return send(chatId, 'Sorry, this bot is private.');
    if (await tooFast(chatId, userId, tapLimiter)) return;
    // Screenshots: a photo, or an image sent as a file. Read the text, show it, then carry on as if it was typed.
    const image = imageOf(m);
    if (image) {
      if (await tooFast(chatId, userId)) return;
      const read = await readScreenshot(chatId, userId, image);
      if (!read) return;
      return handleMessageText(m, chatId, userId, read, { fromImage: true });
    }
    const text = m.text || m.caption;
    if (!text) return send(chatId, F.TEXT_ONLY);
    return handleMessageText(m, chatId, userId, text);
  }

  async function handleMessageText(m, chatId, userId, text, { fromImage = false } = {}) {
    const cmd = !fromImage && text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;
    if (cmd) {
      switch (cmd) {
        case '/start': case '/help': return send(chatId, F.WELCOME);
        case '/tips': return send(chatId, F.TIPS);
        case '/privacy': return send(chatId, F.PRIVACY);
        case '/scammed': return urgentMenu(chatId);
        case '/report': return nextReportStep(chatId);
        case '/check': return send(chatId, F.NEED_MESSAGE);
        case '/share': {
          const st = getState(chatId);
          if (st?.message) return shareSafely(chatId, userId, st.message, st.analysis);
          touch(chatId, { mode: 'await_message_for_share' });
          return send(chatId, '🔒 Send or forward me the scam message, or a screenshot of it. I will hide names, phone numbers and other private details so you can warn your family safely.');
        }
        case '/cancel': states.delete(chatId); return send(chatId, 'Done. I have deleted what you sent me. Send a new message any time.');
        default: return send(chatId, 'I do not know that command. Send me a suspicious message, or tap /start.');
      }
    }
    const s = getState(chatId);
    if (!fromImage && s?.mode === 'await_text_answer' && s.pending) {
      const q = s.pending;
      const details = { ...s.details, [q.key]: q.key === 'amountLost' ? text.replace(/[^\d.,]/g, '').slice(0, 20) || text.slice(0, 20) : text.slice(0, 300) };
      touch(chatId, { details, mode: null, pending: null });
      return nextReportStep(chatId);
    }
    if (!fromImage && s?.mode === 'await_edit' && s.pending) {
      touch(chatId, { details: { ...s.details, [s.pending.key]: text.slice(0, 1500) }, mode: null, pending: null });
      return nextReportStep(chatId);
    }
    if (s?.mode === 'await_message_for_share') {
      if (!fromImage && await tooFast(chatId, userId)) return;
      touch(chatId, { mode: null });
      return shareSafely(chatId, userId, text, null);
    }
    if (s?.mode === 'await_message_for_report') {
      if (!fromImage && await tooFast(chatId, userId)) return;
      await analyseAndReply(chatId, userId, text, forwardName(m) || undefined);
      return nextReportStep(chatId);
    }
    if (!fromImage && !forwardName(m) && text.trim().length < 6 && !/\d/.test(text)) return send(chatId, 'Hi! Please send me the suspicious message you want checked. You can paste it, forward it, or send a screenshot.');
    if (!fromImage && await tooFast(chatId, userId)) return;
    return analyseAndReply(chatId, userId, text, forwardName(m) || undefined);
  }

  async function onCallback(q) {
    const chatId = q.message?.chat?.id;
    const userId = q.from?.id;
    await tg('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (!chatId) return;
    if (allowedUserIds.length && !allowedUserIds.includes(String(userId))) return;
    if (await tooFast(chatId, userId, tapLimiter)) return;
    const [kind, a, b] = String(q.data || '').split(':');
    const s = getState(chatId);
    if (kind === 'rp' && a === 'start') return nextReportStep(chatId);
    if (kind === 'urgent') return a === 'menu' ? urgentMenu(chatId) : urgentReply(chatId, a);
    if (kind === 'sh' && s?.message) { if (await tooFast(chatId, userId)) return; return shareSafely(chatId, userId, s.message, s.analysis); }
    if (!s) return send(chatId, 'That session has expired (I only keep things for 30 minutes). Please send the message again.');
    if (kind === 'yn') { touch(chatId, { details: { ...s.details, [a]: b === '1' } }); return nextReportStep(chatId); }
    if (kind === 'skip') { s.skipped.add(a); touch(chatId, { mode: null, pending: null }); return nextReportStep(chatId); }
    if (kind === 'si') {
      const chosen = new Set(s.details.sharedInfo || []);
      if (a === 'done') { touch(chatId, { details: { ...s.details, sharedInfo: [...chosen], sharedInfoNone: chosen.size === 0 }, pending: null }); if (!chosen.size) s.skipped.add('sharedInfo'); return nextReportStep(chatId); }
      if (a === 'none') { touch(chatId, { details: { ...s.details, sharedInfo: [], sharedInfoNone: true }, pending: null }); return nextReportStep(chatId); }
      chosen.has(a) ? chosen.delete(a) : chosen.add(a);
      touch(chatId, { details: { ...s.details, sharedInfo: [...chosen] } });
      try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [...Object.entries(SHARED_INFO_OPTIONS).map(([k, label]) => [{ text: `${chosen.has(k) ? '✅' : '⬜'} ${label}`, callback_data: `si:${k}` }]), [{ text: 'Done', callback_data: 'si:done' }, { text: 'I shared nothing', callback_data: 'si:none' }]] } }); } catch { /* unchanged markup is fine */ }
      return;
    }
    if (kind === 'ed') { touch(chatId, { mode: 'await_edit', pending: { key: a } }); return send(chatId, a === 'description' ? 'Type what happened, in your own words. I will add it to the draft exactly as you write it.' : 'Type the sender name, number, email or account.'); }
  }

  async function handleUpdate(u) {
    try {
      if (u.message) await onMessage(u.message);
      else if (u.callback_query) await onCallback(u.callback_query);
    } catch (e) {
      log(`handler error: ${e.message}`); // never log message content
      const chatId = u.message?.chat?.id || u.callback_query?.message?.chat?.id;
      if (chatId) await send(chatId, F.GENERIC_ERROR).catch(() => {});
    }
  }

  async function run({ signal } = {}) {
    await tg('deleteWebhook', {}).catch((e) => log(`deleteWebhook: ${e.message}`));
    await tg('setMyCommands', { commands: COMMANDS }).catch((e) => log(`setMyCommands: ${e.message}`));
    log(`SafeKaki bot running (backend: ${backend.mode}). Press Ctrl+C to stop.`);
    let offset = 0, backoff = 1000;
    while (!signal?.aborted) {
      try {
        const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
        backoff = 1000;
        for (const u of updates) { offset = u.update_id + 1; await handleUpdate(u); }
      } catch (e) {
        if (signal?.aborted) break;
        if (e.code === 401) { log('Telegram rejected the bot token (401). Check TELEGRAM_BOT_TOKEN.'); break; }
        if (e.code === 409) log('Another bot instance is polling with this token (409). Stop it first.');
        else log(`getUpdates failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, e.retryAfter ? e.retryAfter * 1000 : backoff));
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }
  return { handleUpdate, run, _states: states };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.error('Cannot start: TELEGRAM_BOT_TOKEN was not found.');
    console.error(`  Looked for the settings file at: ${envStatus.path}`);
    if (!envStatus.loaded) console.error('  That file does not exist. Create a file named exactly ".env" (not ".env.txt") in that folder.');
    else console.error(`  The file exists but has no TELEGRAM_BOT_TOKEN line. Lines it does have: ${envStatus.keys.join(', ') || '(none)'}`);
    console.error('  It should contain one line:  TELEGRAM_BOT_TOKEN=123456789:ABC...   (get one from @BotFather)');
    process.exit(1);
  }
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) console.error('Warning: the token does not look like a BotFather token. Check for typos or extra characters.');
  const ctrl = new AbortController();
  process.on('SIGINT', () => ctrl.abort());
  process.on('SIGTERM', () => ctrl.abort());
  createBot({ token }).run({ signal: ctrl.signal }).then(() => process.exit(0));
}
