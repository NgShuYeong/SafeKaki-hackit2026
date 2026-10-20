import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../telegram-bot/bot.js';
import { makeBackend } from '../telegram-bot/backend.js';
import { analyzeMessage } from '../server/core/analyze.js';

// Mock of Telegram's HTTPS Bot API: records every call.
function mockTelegram({ failSend = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const method = url.split('/').pop();
    const body = JSON.parse(opts.body);
    calls.push({ method, body });
    if (failSend && method === 'sendMessage') return { json: async () => ({ ok: false, error_code: 500 }), status: 500 };
    return { json: async () => ({ ok: true, result: true }), status: 200 };
  };
  const sent = () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body);
  const last = () => sent().at(-1);
  return { calls, fetchImpl, sent, last };
}
const rulesBackend = { mode: 'test', analyze: (i) => analyzeMessage(i, { cfg: { apiKey: '' } }), draft: async (i) => (await import('../server/core/report.js')).buildReportDraft(i) };
const mk = (tg, extra = {}) => createBot({ token: 'TEST', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend: rulesBackend, log: () => {}, ...extra });
let uid = 1000;
const msg = (text, extra = {}) => ({ update_id: 1, message: { message_id: 1, chat: { id: 5, type: 'private' }, from: { id: 5, is_bot: false }, text, ...extra } });
const cb = (data) => ({ update_id: 2, callback_query: { id: 'q', from: { id: 5 }, data, message: { message_id: 9, chat: { id: 5, type: 'private' } } } });

test('/start welcome mentions Singlish and 1799', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('/start'));
  assert.match(tg.last().text, /Singlish/); assert.match(tg.last().text, /1799/);
});

test('example interaction: Singlish bank message -> warning, no certainty, do not click', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('Eh, my bank account kena locked. They ask me to click this link and verify.'));
  const t = tg.last().text;
  assert.match(t, /warning signs|strong signs|Not enough evidence/i);
  assert.ok(!/definitely|100% a scam|is a scam\b/i.test(t.replace(/cannot be 100%/g, '')));
  assert.match(t, /Do not click/i);
  assert.ok(tg.last().reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'rp:start'));
});

test('forwarded message: sender name is captured as unconfirmed in the report', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('Need your OTP to verify your DBS account click dbs-x.test/a', { forward_origin: { type: 'hidden_user', sender_user_name: 'DBS Support' } }));
  await bot.handleUpdate(cb('rp:start'));
  await bot.handleUpdate(cb('yn:moneyLost:0'));
  await bot.handleUpdate(cb('si:none'));
  await bot.handleUpdate(cb('yn:clickedLink:0'));
  await bot.handleUpdate(cb('skip:incidentTime'));
  const all = tg.sent().map((s) => s.text).join('\n');
  assert.match(all, /DBS Support \(name shown on the forwarded message\)/);
  assert.match(all, /NOT submitted/);
  assert.match(all, /<pre>SCAM REPORT/);
  const buttons = tg.last().reply_markup.inline_keyboard.flat().filter((b) => b.url).map((b) => b.url);
  assert.ok(buttons.some((u) => u.includes('scamshield.gov.sg')));
});

test('report flow only asks what is needed, and money loss triggers urgent steps first', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('Please pay now to this account or you get arrested'));
  await bot.handleUpdate(cb('rp:start'));
  assert.match(tg.last().text, /transfer any money/i);
  await bot.handleUpdate(cb('yn:moneyLost:1'));
  assert.match(tg.last().text, /how much/i);
  await bot.handleUpdate(msg('1,500'));
  const qs = tg.sent().map((s) => s.text).filter((t) => t.startsWith('❓'));
  assert.ok(!qs.some((q) => /describe|name of/i.test(q)));
  while (!tg.sent().some((s) => /Your report draft/.test(s.text))) {
    const q = tg.last().text; const kb = tg.last().reply_markup?.inline_keyboard?.flat() || [];
    if (/share any of these/.test(q)) await bot.handleUpdate(cb('si:none'));
    else if (/click the link/.test(q)) await bot.handleUpdate(cb('yn:clickedLink:0'));
    else await bot.handleUpdate(cb(kb.find((b) => b.callback_data?.startsWith('skip:'))?.callback_data || 'skip:x'));
  }
  const texts = tg.sent().map((s) => s.text);
  assert.ok(texts.findIndex((t) => /Before anything else/.test(t)) < texts.findIndex((t) => /Your report draft/.test(t)), 'urgent steps come before the draft');
  assert.match(texts.join('\n'), /1,500/);
});

test('/scammed gives protective steps immediately, before any report', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('/scammed'));
  await bot.handleUpdate(cb('urgent:money'));
  assert.match(tg.last().text, /Call your bank now/);
  assert.match(tg.last().text, /1799/);
  assert.ok(tg.last().reply_markup.inline_keyboard.flat().some((b) => b.url?.startsWith('https://eservices1.police.gov.sg')));
});

test('user saying they already shared OTP gets urgent block at the top of the analysis', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('Eh I already gave the OTP to the bank guy, now money gone how'));
  assert.match(tg.last().text, /^🚨/);
});

test('rate limiting, groups, bots, non-text, and unknown commands', async () => {
  const tg = mockTelegram(); const bot = mk(tg, { ratePerMin: 3 });
  for (let i = 0; i < 5; i++) await bot.handleUpdate(msg('/tips')); // cheap commands do not use up checks
  assert.doesNotMatch(tg.last().text, /going a bit fast/);
  for (let i = 0; i < 3; i++) await bot.handleUpdate(msg(`Need your OTP to verify your account now ${i}`));
  await bot.handleUpdate(msg('Need your OTP to verify your account again'));
  assert.match(tg.last().text, /going a bit fast/);
  const tg2 = mockTelegram(); const bot2 = mk(tg2);
  await bot2.handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 7, type: 'group' }, from: { id: 7 }, text: 'hi' } });
  await bot2.handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 8, type: 'private' }, from: { id: 8, is_bot: true }, text: 'hi' } });
  assert.equal(tg2.sent().length, 0, 'ignores groups and bots');
  await bot2.handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 9, type: 'private' }, from: { id: 9 }, sticker: { file_id: 's' } } });
  assert.match(tg2.last().text, /text and screenshots/);
  await bot2.handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 9, type: 'private' }, from: { id: 9 }, text: '/bogus' } });
  assert.match(tg2.last().text, /do not know that command/);
});

test('allow-list blocks other users when configured', async () => {
  const tg = mockTelegram(); const bot = mk(tg, { allowedUserIds: ['1'] });
  await bot.handleUpdate(msg('/start'));
  assert.match(tg.last().text, /private/);
});

test('/cancel deletes stored message; /privacy explains data handling', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('Need your OTP now click a.test/x'));
  assert.ok(bot._states.has(5));
  await bot.handleUpdate(msg('/cancel'));
  assert.ok(!bot._states.has(5));
  await bot.handleUpdate(msg('/privacy'));
  assert.match(tg.last().text, /30 minutes/); assert.match(tg.last().text, /never what your message said/);
});

test('backend crash or Telegram send failure do not crash the bot or leak internals', async () => {
  const tg = mockTelegram(); const bot = mk(tg, { backend: { mode: 't', analyze: async () => { throw new Error('SECRET_STACK /srv/app.js'); }, draft: async () => { throw new Error('x'); } } });
  await bot.handleUpdate(msg('Need your OTP now'));
  assert.match(tg.last().text, /something went wrong/i);
  assert.ok(!/SECRET_STACK|\.js/.test(tg.last().text));
  const bad = mockTelegram({ failSend: true }); const bot2 = mk(bad);
  await assert.doesNotReject(bot2.handleUpdate(msg('/start')));
});

test('hostile text is HTML-escaped in every bot reply (no markup injection)', async () => {
  const { formatAnalysis, formatReportPreview } = await import('../telegram-bot/format.js');
  const evil = '<a href="http://evil.test">click</a> & <b>x</b>';
  const a = { riskLevel: 'high_risk', headline: 'h', summary: evil, reasons: [evil], suspiciousPhrases: [{ text: evil }], links: [{ host: evil, warnings: [evil] }], nextSteps: [evil], missingInfo: [], notes: [], interpretation: { plainEnglish: evil }, disclaimer: evil, urgent: null };
  const out = formatAnalysis(a);
  assert.ok(!out.includes('<a href'));
  assert.ok(!/<b>x<\/b>/.test(out));
  assert.match(out, /&lt;a href/);
  const rep = formatReportPreview({ submission: { note: evil }, missingKeys: [], fields: [], text: evil });
  assert.ok(!rep.includes('<a href'));
  // end to end: the bot still replies normally to a message containing markup
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('Need your OTP <a href="http://evil.test">click</a> <b>now</b>'));
  assert.ok(!tg.last().text.includes('<a href'));
});

test('HTTP backend mode forwards to the API with the shared secret and client id', async () => {
  let seen;
  const b = makeBackend({ apiUrl: 'http://api.local/', secret: 's3', fetchImpl: async (url, o) => { seen = { url, h: o.headers }; return { json: async () => ({ ok: true }) }; } });
  await b.analyze({ message: 'x', clientId: 42 });
  assert.equal(seen.url, 'http://api.local/api/analyze');
  assert.equal(seen.h['x-safekaki-client'], '42');
});

test('ticking several checkboxes in the report does not trigger the speed limit', async () => {
  const tg = mockTelegram(); const bot = mk(tg, { ratePerMin: 8 });
  await bot.handleUpdate(msg('Need your OTP to verify your DBS account click dbs-x.test/a'));
  await bot.handleUpdate(cb('rp:start'));
  await bot.handleUpdate(cb('yn:moneyLost:0'));
  for (const k of ['otp', 'password', 'card', 'singpass', 'nric', 'other', 'otp', 'card']) await bot.handleUpdate(cb(`si:${k}`));
  await bot.handleUpdate(cb('si:done'));
  assert.ok(!tg.sent().some((m) => /going a bit fast|slow down/i.test(m.text)));
});

test('/start shows big bottom buttons, and tapping one works like the command', async () => {
  const tg = mockTelegram(); const bot = mk(tg);
  await bot.handleUpdate(msg('/start'));
  const keys = tg.last().reply_markup.keyboard.flat().map((k) => k.text);
  assert.ok(keys.includes('🗣 Ask Kakis') && keys.includes('🚨 I got scammed'));
  assert.ok(!keys.includes('🌐 Website')); // no website link set
  await bot.handleUpdate(msg('🚨 I got scammed'));
  assert.match(tg.last().text, /speed matters/);
  await bot.handleUpdate(msg('❓ Help'));
  assert.match(tg.last().text, /What I can do/);
});

test('website link shows in the welcome and the /website command when set', async () => {
  const tg = mockTelegram(); const bot = mk(tg, { websiteUrl: 'https://safekaki.example.sg' });
  await bot.handleUpdate(msg('/start'));
  assert.match(tg.last().text, /safekaki\.example\.sg/);
  assert.ok(tg.last().reply_markup.keyboard.flat().some((k) => k.text === '🌐 Website'));
  await bot.handleUpdate(msg('🌐 Website'));
  assert.match(tg.last().text, /SafeKaki website/);
  const tg2 = mockTelegram(); const bot2 = mk(tg2, { websiteUrl: '' });
  await bot2.handleUpdate(msg('/website'));
  assert.match(tg2.last().text, /not been set up/);
});
