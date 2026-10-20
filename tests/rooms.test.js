import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBot } from '../telegram-bot/bot.js';
import { createRooms, defangLinks } from '../telegram-bot/rooms.js';
import { summarizeRoom, verdictLine } from '../server/core/summarize.js';
import { analyzeMessage } from '../server/core/analyze.js';
import { buildReportDraft } from '../server/core/report.js';

const SCAM = 'Dear customer, your DBS account will be blocked today. Click https://dbs-secure.top/verify and send the OTP to Mr Tan Ah Kow at 9123 4567 now.';

function mockTelegram() {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ method: url.split('/').pop(), body: JSON.parse(opts.body) });
    return { json: async () => ({ ok: true, result: true }), status: 200 };
  };
  const to = (id) => calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(id)).map((c) => c.body);
  const lastTo = (id) => to(id).at(-1);
  const buttons = (body) => (body?.reply_markup?.inline_keyboard || []).flat();
  return { calls, fetchImpl, to, lastTo, buttons };
}
const backend = { mode: 'test', analyze: (i) => analyzeMessage(i, { cfg: { apiKey: '' } }), draft: async (i) => buildReportDraft(i), findNames: async () => ({ ok: true, names: [] }), summarize: async (room) => ({ ok: true, summary: await summarizeRoom(room, { cfg: { apiKey: '' } }) }) };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'safekaki-rooms-'));

function setup(roomOptions = {}) {
  const tg = mockTelegram();
  const dataDir = tmpDir();
  const bot = createBot({ token: 'TEST', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend, log: () => {}, dataDir, roomOptions, demoKakis: false, demoDelayMs: 0 });
  let n = 1;
  const say = (from, text) => bot.handleUpdate({ update_id: n++, message: { message_id: n, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false }, text } });
  const tap = (from, data) => bot.handleUpdate({ update_id: n++, callback_query: { id: 'q', from: { id: from }, data, message: { message_id: 9, chat: { id: from, type: 'private' } } } });
  return { tg, bot, dataDir, say, tap };
}
// Asker 5 checks a scam and opens a room; Kakis 6 and 7 are opted in.
async function openRoomWithKakis(t, kakis = [6, 7]) {
  for (const k of kakis) await t.tap(k, 'kk:on');
  await t.say(5, SCAM);
  await t.tap(5, 'rm:open');
  await t.tap(5, 'rm:post');
  const code = t.tg.buttons(t.tg.lastTo(kakis[0])).find((b) => b.callback_data?.startsWith('rm:join:')).callback_data.split(':')[2];
  return code;
}

test('links are made unclickable, ordinary words are not touched', () => {
  assert.equal(defangLinks('go to https://dbs-secure.top/verify now'), 'go to hxxps://dbs-secure[.]top/verify now');
  assert.equal(defangLinks('see www.dbs.com.sg'), 'see www[.]dbs[.]com[.]sg');
  assert.equal(defangLinks('e.g. call 1799 at 3 p.m.'), 'e.g. call 1799 at 3 p.m.');
});

test('verdict never calls a message safe, and high risk is not overruled by votes', () => {
  assert.equal(verdictLine({ scam: 3, unsure: 1, real: 0 }, 'suspicious'), '3 of 4 Kakis think it is a scam.');
  const v = verdictLine({ scam: 0, unsure: 0, real: 3 }, 'high_risk');
  assert.match(v, /strong warning signs/);
  assert.match(verdictLine({ scam: 0, unsure: 1, real: 2 }, 'insufficient_evidence'), /check with the official source/);
  for (const line of [v, verdictLine({ scam: 0, unsure: 0, real: 1 }, 'suspicious')]) assert.ok(!/\bsafe\b/i.test(line));
  assert.match(verdictLine({ scam: 0, unsure: 0, real: 0 }, 'suspicious'), /Nobody voted/);
});

test('AI summary points that reassure ("safe", "legit") are dropped', async () => {
  const llm = async () => ({ points: ['The link is not the real DBS website.', 'This message is safe.', 'Looks legit to me.', 'Banks never ask for OTPs.'] });
  const s = await summarizeRoom({ original: 'x', riskLevel: 'suspicious', transcript: [{ alias: 'Kaki 1', text: 'fake link' }], votes: ['scam'] }, { cfg: { apiKey: 'k' }, llm });
  assert.equal(s.method, 'ai');
  assert.deepEqual(s.points, ['The link is not the real DBS website.', 'Banks never ask for OTPs.']);
});

test('rules-only summary picks up warning signs the Kakis pointed out', async () => {
  const s = await summarizeRoom({ original: SCAM, riskLevel: 'high_risk', transcript: [{ alias: 'Kaki 1', text: 'They want you to share the OTP, never give that' }], votes: ['scam', 'scam'] }, { cfg: { apiKey: '' } });
  assert.equal(s.method, 'rules');
  assert.ok(s.points.some((p) => /OTP/i.test(p)), s.points.join('|'));
  assert.equal(s.verdict, '2 of 2 Kakis think it is a scam.');
});

test('full room: preview is redacted, Kakis are pinged, chat is relayed, summary on last leave', async () => {
  const t = setup();
  await t.tap(6, 'kk:on'); await t.tap(7, 'kk:on');
  await t.say(5, SCAM);
  assert.ok(t.tg.buttons(t.tg.lastTo(5)).some((b) => b.callback_data === 'rm:open'));
  await t.tap(5, 'rm:open');
  const preview = t.tg.lastTo(5).text;
  assert.ok(!preview.includes('9123 4567'), preview);
  assert.match(preview, /hxxps:\/\/dbs-secure\[\.\]top/);
  await t.tap(5, 'rm:post');
  assert.match(t.tg.to(5).at(-1).text, /pinged 2 Kakis/);
  const ping = t.tg.lastTo(6);
  assert.match(ping.text, /second opinion/);
  assert.ok(!ping.text.includes('9123 4567'));
  const code = t.tg.buttons(ping).find((b) => b.callback_data.startsWith('rm:join:')).callback_data.split(':')[2];

  await t.tap(6, `rm:join:${code}`);
  assert.match(t.tg.lastTo(6).text, /You are in room .* as <b>Kaki 1<\/b>/);
  assert.match(t.tg.lastTo(5).text, /Kaki 1 joined/);

  await t.say(5, 'they also called me from 8765 4321, the site is www.dbs-help.xyz');
  const relayed = t.tg.lastTo(6).text;
  assert.match(relayed, /^<b>Asker:<\/b>/);
  assert.ok(!relayed.includes('8765 4321'), relayed);
  assert.match(relayed, /dbs-help\[\.\]xyz/);
  assert.equal(t.tg.to(7).length, 1 + 1, 'Kaki 7 did not join, so only got the ping (plus kk:on reply)');

  await t.say(6, 'Banks never ask for your OTP. Do not share it.');
  assert.match(t.tg.lastTo(5).text, /^<b>Kaki 1:<\/b> Banks never ask/);

  // While in a room, other commands are paused.
  await t.say(6, '/tips');
  assert.match(t.tg.lastTo(6).text, /type \/leave first/);

  await t.tap(6, `rm:vote:${code}:scam`);
  await t.say(5, '/leave');
  assert.match(t.tg.lastTo(5).text, /Before you go/);
  await t.tap(5, `rm:bye:${code}:scam`);
  assert.match(t.tg.lastTo(6).text, /Asker left/);
  await t.say(6, '/leave'); // already voted, so leaves straight away and the room is empty

  for (const id of [5, 6]) {
    const sum = t.tg.lastTo(id).text;
    assert.match(sum, /Summary of room/);
    assert.match(sum, /everyone has left/);
    assert.match(sum, /2 of 2 Kakis think it is a scam/);
  }
  assert.ok(!t.tg.lastTo(7).text.includes('Summary'), 'people who never joined get no summary');
  assert.equal(t.bot._rooms.roomOf(5), null);

  const saved = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'room-summaries.json'), 'utf8'));
  assert.equal(saved.length, 1);
  const raw = JSON.stringify(saved);
  assert.ok(!raw.includes('Banks never ask') && !raw.includes('dbs-help'), 'chat log is not saved');
  assert.ok(!raw.includes('"5"') && !raw.includes('"6"'), 'user IDs are not saved with summaries');
  assert.deepEqual(saved[0].votes, { scam: 2, unsure: 0, real: 0 });
  t.bot.stop();
});

test('no Kakis available: room is not opened', async () => {
  const t = setup();
  await t.say(5, SCAM);
  await t.tap(5, 'rm:open');
  await t.tap(5, 'rm:post');
  assert.match(t.tg.lastTo(5).text, /no Kakis are free/);
  assert.equal(t.bot._rooms.roomOf(5), null);
  t.bot.stop();
});

test('only Kakis can join, and a full room turns people away', async () => {
  const t = setup({ maxPeople: 2 });
  const code = await openRoomWithKakis(t, [6, 7]);
  await t.tap(8, `rm:join:${code}`);
  assert.match(t.tg.lastTo(8).text, /Only Kakis can join/);
  await t.tap(6, `rm:join:${code}`);
  await t.tap(7, `rm:join:${code}`);
  assert.match(t.tg.lastTo(7).text, /room is full/);
  t.bot.stop();
});

test('room closes after 20 quiet minutes and after 1 hour, with a summary', async () => {
  let clock = 1_000_000;
  const t = setup({ now: () => clock });
  const code = await openRoomWithKakis(t, [6]);
  await t.tap(6, `rm:join:${code}`);
  clock += 19 * 60_000; await t.bot._checkRooms();
  assert.ok(t.bot._rooms.roomOf(5), 'still open at 19 minutes');
  clock += 2 * 60_000; await t.bot._checkRooms();
  assert.equal(t.bot._rooms.roomOf(5), null);
  assert.match(t.tg.lastTo(6).text, /quiet for 20 minutes/);
  t.bot.stop();

  clock = 1_000_000;
  const t2 = setup({ now: () => clock });
  const code2 = await openRoomWithKakis(t2, [6]);
  await t2.tap(6, `rm:join:${code2}`);
  for (let i = 0; i < 7; i++) { clock += 9 * 60_000; await t2.say(6, 'still looking'); await t2.bot._checkRooms(); }
  assert.equal(t2.bot._rooms.roomOf(5), null);
  assert.match(t2.tg.lastTo(5).text, /1-hour limit/);
  t2.bot.stop();
});

test('two reports remove a person from the room', async () => {
  const t = setup();
  const code = await openRoomWithKakis(t, [6, 7, 8]);
  for (const k of [6, 7, 8]) await t.tap(k, `rm:join:${code}`);
  await t.tap(5, `rm:repmenu:${code}`);
  assert.ok(t.tg.buttons(t.tg.lastTo(5)).some((b) => b.text === 'Kaki 3'));
  await t.tap(5, `rm:rep:${code}:Kaki 3`);
  assert.ok(t.bot._rooms.get(code).members.has('8'));
  await t.tap(6, `rm:rep:${code}:Kaki 3`);
  assert.ok(!t.bot._rooms.get(code).members.has('8'));
  assert.match(t.tg.lastTo(8).text, /removed from the room/);
  await t.tap(8, `rm:join:${code}`);
  assert.match(t.tg.lastTo(8).text, /cannot rejoin/);
  t.bot.stop();
});

test('the asker can end the room; others cannot', async () => {
  const t = setup();
  const code = await openRoomWithKakis(t, [6]);
  await t.tap(6, `rm:join:${code}`);
  await t.say(6, '/end');
  assert.match(t.tg.lastTo(6).text, /Only the person who opened the room/);
  await t.say(5, '/end');
  assert.match(t.tg.lastTo(6).text, /asker closed it/);
  t.bot.stop();
});

test('Kaki list is saved to disk and can be left', async () => {
  const dir = tmpDir();
  const a = createRooms({ dataDir: dir });
  a.setHelper(42, true);
  assert.ok(createRooms({ dataDir: dir }).isHelper(42));
  a.setHelper(42, false);
  assert.ok(!createRooms({ dataDir: dir }).isHelper(42));
});

test('demo mode: two pretend Kakis join, chat, vote and leave, then the asker gets a summary', async () => {
  const tg = mockTelegram();
  const dataDir = tmpDir();
  const bot = createBot({ token: 'TEST', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend, log: () => {}, dataDir, demoKakis: true, demoDelayMs: 0 });
  let n = 1;
  const say = (from, text) => bot.handleUpdate({ update_id: n++, message: { message_id: n, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false }, text } });
  const tap = (from, data) => bot.handleUpdate({ update_id: n++, callback_query: { id: 'q', from: { id: from }, data, message: { message_id: 9, chat: { id: from, type: 'private' } } } });
  try {
    await say(5, SCAM); // no real Kakis exist, demo mode still opens the room
    await tap(5, 'rm:open');
    await tap(5, 'rm:post');
    const code = bot._rooms.roomOf(5).code;
    assert.match(tg.to(5).map((b) => b.text).join('\n'), /Demo mode/);
    await bot._demoDone();
    const seen = tg.to(5).map((b) => b.text).join('\n');
    assert.match(seen, /Kaki 1 \(demo\) joined/);
    assert.match(seen, /Kaki 2 \(demo\):<\/b> Agree/);
    assert.match(seen, /voted 🚩 Scam and left/);
    // Nothing is ever sent to a pretend Kaki.
    assert.ok(!tg.calls.some((c) => String(c.body.chat_id || '').startsWith('demo-')));
    // The asker votes and leaves: the room is empty, so it closes with a summary.
    await tap(5, 'rm:leave');
    await tap(5, `rm:bye:${code}:scam`);
    const summary = tg.to(5).map((b) => b.text).find((t) => t.includes('Summary of room'));
    assert.ok(summary, 'summary sent');
    assert.match(summary, /3 of 3 Kakis think it is a scam/);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'room-summaries.json'), 'utf8'));
    assert.equal(saved.at(-1).demo, true);
  } finally { bot.stop(); }
});

test('without demo mode, no Kakis means no room', async () => {
  const t = setup();
  try {
    await t.say(5, SCAM);
    await t.tap(5, 'rm:open');
    await t.tap(5, 'rm:post');
    assert.match(t.tg.lastTo(5).text, /no Kakis are free/);
    assert.equal(t.bot._rooms.roomOf(5), null);
  } finally { t.bot.stop(); }
});

test('/demo turns demo Kakis on for that person only, and /demo again turns it off', async () => {
  const t = setup({});
  try {
    await t.say(5, '/demo');
    assert.match(t.tg.lastTo(5).text, /Demo mode is on/);
    await t.tap(5, 'demo:sample'); // sample scam message is checked
    assert.ok(t.tg.to(5).some((b) => /High risk/i.test(b.text)));
    await t.tap(5, 'rm:open');
    await t.tap(5, 'rm:post'); // no real Kakis, but the room still opens
    assert.ok(t.bot._rooms.roomOf(5));
    await t.bot._demoDone();
    assert.match(t.tg.to(5).map((b) => b.text).join('\n'), /Kaki 1 \(demo\) joined/);
    await t.say(5, '/end');
    // Someone else without /demo still gets the normal "no Kakis" answer.
    await t.say(8, SCAM);
    await t.tap(8, 'rm:open');
    await t.tap(8, 'rm:post');
    assert.match(t.tg.lastTo(8).text, /no Kakis are free/);
    await t.say(5, '/demo');
    assert.match(t.tg.lastTo(5).text, /Demo mode is <b>off<\/b>/);
  } finally { t.bot.stop(); }
});
