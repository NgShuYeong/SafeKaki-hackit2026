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
import { createRooms, defangLinks } from './rooms.js';
import { summarizeRoom } from '../server/core/summarize.js';

const DEFAULT_DATA_DIR = process.env.SAFEKAKI_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const STATE_TTL_MS = 30 * 60 * 1000;
const COMMANDS = [
  { command: 'start', description: 'Say hello' },
  { command: 'report', description: 'Prepare a scam report' },
  { command: 'share', description: 'Hide names and numbers so you can warn family' },
  { command: 'scammed', description: 'Urgent help: I already shared a code or sent money' },
  { command: 'discuss', description: 'Open a chat room so Kakis can help you decide' },
  { command: 'kaki', description: 'Become a Kaki: help others spot scams' },
  { command: 'rooms', description: 'Kakis: see rooms that need help' },
  { command: 'leave', description: 'Leave the discussion room' },
  { command: 'tips', description: 'How to spot scams' },
  { command: 'privacy', description: 'What happens to my messages' },
  { command: 'cancel', description: 'Delete what you sent me and start over' },
  { command: 'help', description: 'Everything I can do' },
];
// Text sent by the big bottom buttons, and the command each one stands for.
const BUTTON_COMMANDS = {
  [F.BUTTONS.check]: '/check', [F.BUTTONS.kakis]: '/discuss', [F.BUTTONS.scammed]: '/scammed',
  [F.BUTTONS.share]: '/share', [F.BUTTONS.help]: '/help', [F.BUTTONS.website]: '/website',
};

export function createBot({ token, backend = makeBackend(), fetchImpl = fetch, apiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org', allowedUserIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean), ratePerMin = Number(process.env.BOT_RATE_LIMIT_PER_MIN) || 8, log = console.log, dataDir = DEFAULT_DATA_DIR, roomOptions = {}, demoKakis = process.env.DEMO_KAKIS === '1', demoDelayMs = Number(process.env.DEMO_KAKIS_DELAY_MS) || 3500, websiteUrl = (process.env.SAFEKAKI_WEBSITE_URL || '').trim() } = {}) {
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
  const rooms = createRooms({ dataDir, ...roomOptions });
  const roomOpenLimiter = createLimiter({ windowMs: 60 * 60_000, max: 3 }); // 3 new rooms an hour per person
  const roomChatLimiter = createLimiter({ windowMs: 60_000, max: 20 }); // 20 room messages a minute per person

  // ---- Telegram API (official Bot API over HTTPS) ----
  async function tg(method, payload = {}) {
    const res = await fetchImpl(`${apiBase}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(payload.timeout ? (payload.timeout + 15) * 1000 : 20000) });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) { const e = new Error(`telegram_${data.error_code || res.status}`); e.retryAfter = data.parameters?.retry_after; e.code = data.error_code; throw e; }
    return data.result;
  }
  // Pretend Kakis in demo mode have IDs like "demo-ABCD-1". They have no Telegram chat, so nothing is sent to them.
  const isDemoId = (id) => String(id).startsWith('demo-');
  async function send(chatId, text, extra = {}) {
    if (isDemoId(chatId)) return;
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
    const rows = [[{ text: '📝 Prepare a report', callback_data: 'rp:start' }], [{ text: '🔒 Warn family safely', callback_data: 'sh:go' }], [{ text: '🗣 Discuss with Kakis', callback_data: 'rm:open' }]];
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

  // ---- Kaki discussion rooms ----
  // A room lives inside each person's private chat with the bot; the bot copies messages between them.
  const roomMenu = (code) => kb([[{ text: '🗳 Vote', callback_data: `rm:vmenu:${code}` }, { text: '⚠️ Report someone', callback_data: `rm:repmenu:${code}` }], [{ text: '🚪 Leave room', callback_data: 'rm:leave' }]]);
  const voteRow = (code, prefix) => [[{ text: '🚩 Scam', callback_data: `${prefix}:${code}:scam` }, { text: '🤔 Not sure', callback_data: `${prefix}:${code}:unsure` }, { text: '✅ Looks real', callback_data: `${prefix}:${code}:real` }]];
  const cleanForRoom = (text) => defangLinks(redactLocal(text).text);
  async function tellRoom(room, html, exceptId) {
    for (const id of room.members.keys()) if (id !== String(exceptId)) await send(id, html);
  }

  async function roomDraft(chatId, userId) {
    if (rooms.roomOf(userId)) return send(chatId, 'You are already in a discussion room. Type /leave first.');
    const s = getState(chatId);
    if (!s?.message) { touch(chatId, { mode: 'await_message_for_room' }); return send(chatId, '🗣 Send or forward me the message you want to discuss, or a screenshot of it. I will check it first, then you can open a room.'); }
    let result = redactLocal(s.message);
    try {
      const r = await backend.findNames({ text: result.text, clientId: userId });
      if (r?.ok && r.names?.length) result = redactLocal(s.message, { extraNames: r.names });
    } catch { /* rules-only is fine */ }
    const text = defangLinks(result.text);
    touch(chatId, { roomDraft: text });
    return send(chatId, F.formatRoomPreview(text, result.items), kb([[{ text: '✅ Open the room', callback_data: 'rm:post' }, { text: 'Cancel', callback_data: 'rm:cancel' }]]));
  }

  async function openRoom(chatId, userId) {
    const s = getState(chatId);
    if (!s?.roomDraft) return send(chatId, 'That has expired. Please send the message again, then tap 🗣 Discuss with Kakis.');
    if (rooms.roomOf(userId)) return send(chatId, 'You are already in a discussion room. Type /leave first.');
    const demo = demoKakis || demoUsers.has(String(userId));
    const helpers = rooms.pickHelpers(userId);
    if (!helpers.length && !demo) return send(chatId, 'Sorry, no Kakis are free right now. Please try again later, or call the ScamShield Helpline 1799 to check the message with them.');
    const rl = roomOpenLimiter.check(`r:${userId}`);
    if (!rl.allowed) return send(chatId, 'You have opened a few rooms already. Please wait a while before opening another one.');
    const a = s.analysis || {};
    const room = rooms.create({ ownerId: userId, original: s.roomDraft, riskLevel: a.riskLevel || 'insufficient_evidence', category: a.scamCategory, headline: a.headline });
    touch(chatId, { roomDraft: null });
    const pinged = helpers.length ? `🔔 I pinged ${helpers.length} ${helpers.length === 1 ? 'Kaki' : 'Kakis'}. I will tell you when someone joins.` : '';
    const demoNote = demo ? '🧪 <b>Demo mode:</b> 2 pretend Kakis will join in a few seconds to show how a room works.' : '';
    await send(chatId, F.formatRoomWelcome(room, 'Asker', 1) + '\n\n' + [pinged, demoNote].filter(Boolean).join('\n'), roomMenu(room.code));
    for (const id of helpers) await send(id, F.formatRoomPing(room), kb([[{ text: '🙋 Join', callback_data: `rm:join:${room.code}` }]]));
    if (demo) lastDemo = runDemo(room.code).catch((e) => log(`demo failed: ${e.message}`));
  }

  // ---- Demo mode (DEMO_KAKIS=1): two pretend Kakis join, chat, vote and leave ----
  // For showing rooms with one phone. Off unless switched on in .env. Pretend Kakis are labelled "(demo)".
  const DEMO_SCRIPTS = {
    high_risk: { votes: ['scam', 'scam'], lines: [
      [1, 'Wah, this one looks dodgy. Banks will never ask you to click a link to unlock your account.'],
      [2, 'Agree. The link is not the real bank website, and they are rushing you. Do not click and do not reply.'],
      [1, 'If you are worried, call the bank using the number on the back of your card, not the number in the message.'],
    ] },
    suspicious: { votes: ['scam', 'unsure'], lines: [
      [1, 'Hmm, something feels off. They want you to act fast, which is a common scam trick.'],
      [2, 'Do not click the link first. Check in the official app, or call 1799 to ask.'],
      [1, 'Never share your OTP or password with anyone, even if they say they are from the bank.'],
    ] },
    insufficient_evidence: { votes: ['unsure', 'unsure'], lines: [
      [1, 'Hard to tell from this alone. Do you know who sent it?'],
      [2, 'If it says it is from someone you know, call them on their old number to check. Do not send money or codes first.'],
      [1, 'When unsure, you can call the ScamShield Helpline 1799.'],
    ] },
  };
  const demoRooms = new Set();
  // /demo turns demo Kakis on for one person's own rooms. Kept in memory, so a restart turns it off.
  const demoUsers = new Set();
  const DEMO_SAMPLE = 'DBS Alert: Your account has been blocked due to suspicious activity. Click https://dbs-sg-verify.top/login within 24 hours and enter the OTP we send you to unlock it, or your account will be closed.';
  async function demoCommand(chatId, userId) {
    const id = String(userId);
    if (demoUsers.has(id)) { demoUsers.delete(id); return send(chatId, '🧪 Demo mode is <b>off</b>. Your rooms will only have real Kakis again.'); }
    demoUsers.add(id);
    return send(chatId, `🧪 <b>Demo mode is on</b> (only for you).

When you open a room, 2 pretend Kakis will join, chat, vote and leave, so you can show how a room works with one phone. Real Kakis are still pinged too.

How to run it:
1. Send or forward a scam message, or tap the button below to use a sample.
2. Tap <b>🗣 Discuss with Kakis</b>, then <b>✅ Open the room</b>.
3. Watch the Kakis join. Then vote and /leave to get the summary.

Type /demo again to turn it off.`, kb([[{ text: '📩 Use a sample scam message', callback_data: 'demo:sample' }]]));
  }
  let lastDemo = Promise.resolve();
  async function runDemo(code) {
    demoRooms.add(code);
    const alive = () => { const r = rooms.get(code); return r && !r.closed ? r : null; };
    const script = DEMO_SCRIPTS[alive()?.riskLevel] || DEMO_SCRIPTS.insufficient_evidence;
    const wait = () => new Promise((r) => setTimeout(r, demoDelayMs));
    const ids = { 1: `demo-${code}-1`, 2: `demo-${code}-2` };
    const joined = [];
    for (const [k, text] of script.lines) {
      await wait();
      if (!alive()) return;
      if (!joined.includes(k)) {
        const r = rooms.join(code, ids[k], { demo: true });
        if (!r.ok) continue;
        joined.push(k);
        await tellRoom(r.room, F.roomNotice(`${r.alias} joined. ${r.room.members.size} people are here.`), ids[k]);
        await wait();
        if (!alive()) return;
      }
      const said = rooms.say(ids[k], cleanForRoom(text));
      if (!said) continue;
      for (const id of said.to) await send(id, F.roomLine(said.alias, said.text));
    }
    for (const k of joined) {
      await wait();
      if (!alive()) return;
      const choice = script.votes[k - 1];
      rooms.vote(code, ids[k], choice);
      const left = rooms.leave(ids[k]);
      if (!left) continue;
      if (left.empty) return closeRoom(code, 'empty');
      const n = left.room.members.size;
      await tellRoom(left.room, F.roomNotice(`${left.alias} voted ${{ scam: '🚩 Scam', unsure: '🤔 Not sure', real: '✅ Looks real' }[choice]} and left. ${n} ${n === 1 ? 'person is' : 'people are'} still here.`));
    }
  }

  async function joinRoom(chatId, userId, code) {
    if (!rooms.isHelper(userId)) return send(chatId, 'Only Kakis can join rooms. Tap /kaki to become one.');
    const r = rooms.join(code, userId);
    if (!r.ok) {
      const why = { gone: 'That room has already closed. Thank you for offering to help!', full: 'That room is full. Thank you for offering to help!', busy: 'You are already in another room. Type /leave first.', removed: 'You cannot rejoin this room.' };
      return send(chatId, why[r.reason]);
    }
    const { room, alias } = r;
    await send(chatId, F.formatRoomWelcome(room, alias, room.members.size), roomMenu(room.code));
    await tellRoom(room, F.roomNotice(`${alias} ${r.rejoined ? 'came back' : 'joined'}. ${room.members.size} people are here.`), userId);
  }

  async function askBeforeLeaving(chatId, userId) {
    const room = rooms.roomOf(userId);
    if (!room) return send(chatId, 'You are not in a discussion room.');
    if (room.votes.has(String(userId))) return leaveRoom(chatId, userId);
    return send(chatId, '🗳 Before you go, what do you think?', kb([...voteRow(room.code, 'rm:bye'), [{ text: 'Leave without voting', callback_data: `rm:bye:${room.code}:skip` }, { text: 'Stay', callback_data: 'rm:stay' }]]));
  }

  async function leaveRoom(chatId, userId) {
    const left = rooms.leave(userId);
    if (!left) return send(chatId, 'You are not in a discussion room.');
    const { room, alias, empty } = left;
    await send(chatId, `🚪 You left room #${room.code}. I will send you the summary when the room closes.`);
    if (empty) return closeRoom(room.code, 'empty');
    await tellRoom(room, F.roomNotice(`${alias} left. ${room.members.size} ${room.members.size === 1 ? 'person is' : 'people are'} still here.`));
  }

  async function closeRoom(code, reason) {
    const snap = rooms.close(code);
    if (!snap) return;
    let summary;
    try {
      const r = backend.summarize ? await backend.summarize(snap) : { ok: true, summary: await summarizeRoom(snap) };
      summary = r?.ok ? r.summary : null;
    } catch { summary = null; }
    if (!summary) summary = await summarizeRoom(snap, { cfg: { apiKey: '' } }); // rules-only fallback
    snap.transcript = []; // the chat log is not kept
    const text = F.formatRoomSummary(code, reason, summary);
    for (const id of snap.recipients) await send(id, text);
    const demo = demoRooms.delete(code);
    rooms.saveSummary({ code, closedAt: new Date().toISOString(), ...(demo ? { demo: true } : {}), reason, message: snap.original, riskLevel: snap.riskLevel, category: snap.category || null, votes: summary.counts, points: summary.points, method: summary.method, messages: summary.messageCount, people: snap.peopleCount });
  }

  async function checkRooms() {
    for (const { room, reason } of rooms.expired()) {
      await tellRoom(room, F.roomNotice(reason === 'max' ? 'This room has reached the 1-hour limit and is closing now.' : 'This room has been quiet for 20 minutes and is closing now.'));
      await closeRoom(room.code, reason).catch((e) => log(`room close failed: ${e.message}`));
    }
  }
  const roomTimer = setInterval(() => { checkRooms().catch(() => {}); }, 30_000);
  roomTimer.unref?.();

  async function roomMessage(m, chatId, userId, text, cmd) {
    const room = rooms.roomOf(userId);
    if (cmd) {
      if (cmd === '/leave') return askBeforeLeaving(chatId, userId);
      if (cmd === '/end') {
        if (room.ownerId !== String(userId)) return send(chatId, 'Only the person who opened the room can close it. You can /leave any time.');
        await tellRoom(room, F.roomNotice('The asker closed the room.'), userId);
        return closeRoom(room.code, 'ended');
      }
      if (cmd === '/privacy') return send(chatId, F.PRIVACY);
      if (cmd === '/scammed') return urgentMenu(chatId); // urgent help is never blocked by a room
      return send(chatId, `You are in room #${room.code}. Anything you type goes to the room. To do something else, type /leave first.`, roomMenu(room.code));
    }
    const rl = roomChatLimiter.check(`c:${userId}`);
    if (!rl.allowed) return send(chatId, `You are typing a bit fast. Please wait ${rl.retryAfterSec} seconds.`);
    const said = rooms.say(userId, cleanForRoom(text));
    for (const id of said.to) await send(id, F.roomLine(said.alias, said.text));
  }

  async function roomCallback(q, chatId, userId) {
    const [, act, code, arg] = String(q.data).split(':');
    if (act === 'open') { if (await tooFast(chatId, userId)) return; return roomDraft(chatId, userId); }
    if (act === 'post') return openRoom(chatId, userId);
    if (act === 'cancel') { touch(chatId, { roomDraft: null }); return send(chatId, 'OK, I did not open a room.'); }
    if (act === 'join') return joinRoom(chatId, userId, code);
    if (act === 'leave') return askBeforeLeaving(chatId, userId);
    if (act === 'stay') return send(chatId, 'OK, you are still in the room.');
    if (act === 'vmenu') return send(chatId, '🗳 What do you think? You can change your vote until the room closes.', kb(voteRow(code, 'rm:vote')));
    if (act === 'vote' || act === 'bye') {
      if (arg !== 'skip') {
        const ok = rooms.vote(code, userId, arg);
        if (!ok && act === 'vote') return send(chatId, 'That room has closed.');
        if (ok && act === 'vote') await send(chatId, `Thanks, your vote is in: ${{ scam: '🚩 Scam', unsure: '🤔 Not sure', real: '✅ Looks real' }[arg]}.`);
      }
      if (act === 'bye' && rooms.roomOf(userId)?.code === code) return leaveRoom(chatId, userId);
      return;
    }
    if (act === 'repmenu') {
      const room = rooms.get(code);
      if (!room || !room.members.has(String(userId))) return send(chatId, 'That room has closed.');
      const names = [...room.members.entries()].filter(([id]) => id !== String(userId)).map(([, a]) => a);
      if (!names.length) return send(chatId, 'Nobody else is in the room.');
      return send(chatId, '⚠️ Who is being rude, spamming, or asking for private details? If 2 people report the same person, they are removed.', kb(names.map((a) => [{ text: a, callback_data: `rm:rep:${code}:${a}` }])));
    }
    if (act === 'rep') {
      const r = rooms.report(code, userId, arg);
      if (!r.ok) return send(chatId, 'I could not report that person. They may have left already.');
      await send(chatId, 'Thanks, I noted your report.');
      if (r.removedId) {
        await send(r.removedId, '🚫 You were removed from the room after reports from other people.');
        const room = rooms.get(code);
        if (room) { await tellRoom(room, F.roomNotice(`${arg} was removed from the room.`)); if (!room.members.size) await closeRoom(code, 'empty'); }
      }
    }
  }

  async function kakiMenu(chatId, userId) {
    const on = rooms.isHelper(userId);
    return send(chatId, F.KAKI_INTRO(on, rooms.helperCount()), kb([[on ? { text: '🛑 Stop being a Kaki', callback_data: 'kk:off' } : { text: '🙋 Join as a Kaki', callback_data: 'kk:on' }]]));
  }
  async function listRooms(chatId, userId) {
    if (!rooms.isHelper(userId)) return send(chatId, 'Only Kakis can join rooms. Tap /kaki to become one.');
    const open = rooms.openRooms().filter((r) => r.members.size < rooms.maxPeople && !r.members.has(String(userId)));
    if (!open.length) return send(chatId, 'No rooms need help right now. I will ping you when one opens.');
    for (const r of open.slice(0, 5)) await send(chatId, F.formatRoomPing(r), kb([[{ text: '🙋 Join', callback_data: `rm:join:${r.code}` }]]));
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
    if (rooms.roomOf(userId) && (image || !(m.text || m.caption))) return send(chatId, 'Only text messages can be sent in a room. Please type what you want to say.');
    if (image) {
      if (await tooFast(chatId, userId)) return;
      const read = await readScreenshot(chatId, userId, image);
      if (!read) return;
      return handleMessageText(m, chatId, userId, read, { fromImage: true });
    }
    const text = m.text || m.caption;
    if (!text) return send(chatId, m.voice || m.audio || m.video_note ? F.VOICE_NOTE : F.TEXT_ONLY);
    return handleMessageText(m, chatId, userId, text);
  }

  async function handleMessageText(m, chatId, userId, text, { fromImage = false } = {}) {
    const button = !fromImage && BUTTON_COMMANDS[text.trim()];
    const cmd = button || (!fromImage && text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null);
    if (!fromImage && rooms.roomOf(userId)) return roomMessage(m, chatId, userId, text, cmd);
    if (cmd) {
      switch (cmd) {
        case '/start': return send(chatId, F.WELCOME(websiteUrl), { reply_markup: F.mainKeyboard(websiteUrl) });
        case '/help': return send(chatId, F.HELP(websiteUrl), { reply_markup: F.mainKeyboard(websiteUrl) });
        case '/website': return send(chatId, F.WEBSITE(websiteUrl));
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
        case '/discuss': return roomDraft(chatId, userId);
        case '/kaki': return kakiMenu(chatId, userId);
        case '/demo': return demoCommand(chatId, userId); // not in the command menu on purpose
        case '/rooms': return listRooms(chatId, userId);
        case '/leave': case '/end': return send(chatId, 'You are not in a discussion room.');
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
    if (s?.mode === 'await_message_for_room') {
      if (!fromImage && await tooFast(chatId, userId)) return;
      touch(chatId, { mode: null });
      await analyseAndReply(chatId, userId, text, forwardName(m) || undefined);
      return roomDraft(chatId, userId);
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
    if (kind === 'rm') return roomCallback(q, chatId, userId);
    if (kind === 'demo' && a === 'sample') {
      if (rooms.roomOf(userId)) return send(chatId, 'You are in a room. Type /leave first.');
      await send(chatId, `📩 Sample message:\n<pre>${F.esc(DEMO_SAMPLE)}</pre>`);
      return analyseAndReply(chatId, userId, DEMO_SAMPLE);
    }
    if (kind === 'kk') {
      rooms.setHelper(userId, a === 'on');
      return send(chatId, a === 'on' ? '✅ You are now a Kaki. Thank you! I will ping you when someone needs a second opinion. Type /rooms to see rooms open now.' : 'OK, you are no longer a Kaki and I will not ping you. I removed your ID from the Kaki list.');
    }
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
    await tg('setMyCommands', { commands: websiteUrl ? [...COMMANDS, { command: 'website', description: 'Open the SafeKaki website' }] : COMMANDS }).catch((e) => log(`setMyCommands: ${e.message}`));
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
  return { handleUpdate, run, _states: states, _rooms: rooms, _checkRooms: checkRooms, _demoDone: () => lastDemo, stop: () => { clearInterval(roomTimer); clearInterval(sweep); } };
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
