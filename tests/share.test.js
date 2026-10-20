// "Warn family safely" (privacy hiding), merged in from the 12 Oct SafeAlerts build.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { redactLocal, splitRedacted, describeHidden } from '../shared/redact.js';
import { findNamesWithAi } from '../server/core/redactNames.js';
import { createApp } from '../server/index.js';
import { createBot } from '../telegram-bot/bot.js';
import { analyzeMessage } from '../server/core/analyze.js';

const SAMPLE = 'Hi Mary Tan, this is Officer David Lee. Call +65 9123 4567 or 1799. NRIC S1234567D. OTP is 482910. Card 4111 1111 1111 1111. Email kelly@mail.com. Blk 123 Ang Mo Kio Ave 3 #05-67. Click https://dbs-x.top/a';

test('rules hide names, phones, NRIC, OTP, card, email and address but keep links and 1799', () => {
  const r = redactLocal(SAMPLE);
  for (const secret of ['Mary Tan', 'David Lee', '9123 4567', 'S1234567D', '482910', '4111', 'kelly@mail.com', 'Ang Mo Kio']) assert.ok(!r.text.includes(secret), secret);
  assert.ok(r.text.includes('https://dbs-x.top/a'));
  assert.ok(r.text.includes('1799'));
  assert.match(r.text, /OTP is \[CODE 1\]/);
  assert.match(describeHidden(r.items), /2 names/);
});
test('the same detail gets the same label; extra names from the user are hidden', () => {
  const r = redactLocal('Call 9123 4567 now. I repeat 9123 4567. Signed Ah Seng', { extraNames: ['Ah Seng'] });
  assert.equal((r.text.match(/\[PHONE 1\]/g) || []).length, 2);
  assert.ok(!r.text.includes('Ah Seng'));
});
test('ordinary words after Hi are not treated as names', () => {
  assert.equal(redactLocal('Hi Customer, your parcel is waiting.').items.length, 0);
});
test('splitRedacted splits labels out for display', () => {
  assert.deepEqual(splitRedacted('Call [PHONE 1] now'), ['Call ', '[PHONE 1]', ' now']);
});
test('AI name step: only keeps names that are really in the text; never throws', async () => {
  const ok = await findNamesWithAi('Hello from Jason at the bank', { llm: async () => ({ names: ['Jason', 'Invented Person', 5] }) });
  assert.deepEqual(ok, { names: ['Jason'], usedAI: true });
  const fail = await findNamesWithAi('Hello Jason', { llm: async () => { throw new Error('down'); } });
  assert.deepEqual(fail, { names: [], usedAI: false });
  const off = await findNamesWithAi('Hello Jason', { cfg: { apiKey: '' } });
  assert.equal(off.usedAI, false);
});

let server, base, seen;
before(async () => {
  process.env.LLM_API_KEY = ''; process.env.ANTHROPIC_API_KEY = '';
  const app = createApp({ findNames: async (t) => { seen = t; return { names: ['Jason'], usedAI: true }; } });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('API re-hides numbers before the AI step, even if the client sent raw text', async () => {
  const r = await fetch(base + '/api/share/names', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Jason here, call 9123 4567, NRIC S1234567D' }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j, { ok: true, names: ['Jason'], usedAI: true });
  assert.ok(!seen.includes('9123') && !seen.includes('S1234567D'));
  const bad = await fetch(base + '/api/share/names', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '' }) });
  assert.equal(bad.status, 400);
});

function mockTelegram() {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ method: url.split('/').pop(), body: JSON.parse(opts.body) }); return { json: async () => ({ ok: true, result: true }), status: 200 }; };
  return { fetchImpl, sent: () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body) };
}
const backend = { mode: 'test', analyze: (i) => analyzeMessage(i, { cfg: { apiKey: '' } }), draft: async () => ({ ok: false }), findNames: async () => ({ ok: true, names: [], usedAI: false }) };
const msg = (text) => ({ update_id: 1, message: { message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7, is_bot: false }, text } });

test('bot: "Warn family safely" button after a check returns a hidden-details version', async () => {
  const tg = mockTelegram();
  const bot = createBot({ token: 'T', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend, log: () => {} });
  await bot.handleUpdate(msg("Hi Mary Tan, I'm from the bank. Need your OTP to verify. Call 9123 4567"));
  assert.ok(tg.sent().at(-1).reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'sh:go'));
  await bot.handleUpdate({ update_id: 2, callback_query: { id: 'q', from: { id: 7 }, data: 'sh:go', message: { message_id: 2, chat: { id: 7, type: 'private' } } } });
  const t = tg.sent().at(-1).text;
  assert.match(t, /Safe to share/);
  assert.match(t, /\[PHONE 1\]/);
  assert.ok(!t.includes('9123 4567') && !t.includes('Mary Tan'));
  assert.match(t, /1799/);
});
test('bot: /share with nothing held asks for a message, then hides it without analysing', async () => {
  const tg = mockTelegram();
  let analysed = 0;
  const bot = createBot({ token: 'T', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend: { ...backend, analyze: async (i) => { analysed++; return backend.analyze(i); } }, log: () => {} });
  await bot.handleUpdate(msg('/share'));
  assert.match(tg.sent().at(-1).text, /Send or forward me the scam message/);
  await bot.handleUpdate(msg('Uncle Lim, transfer to 123-45678-9 today'));
  const t = tg.sent().at(-1).text;
  assert.match(t, /\[BANK ACCT 1\]/);
  assert.ok(!t.includes('123-45678-9'));
  assert.equal(analysed, 0);
});

test('names with "Ah" are hidden in full without an AI key', () => {
  for (const [input, gone] of [
    ['Send the OTP to Mr Tan Ah Kow at once.', 'Ah Kow'],
    ['Hi Ah Huat, your parcel is held.', 'Huat'],
    ['Uncle Ah Seng please call me', 'Seng'],
  ]) {
    const r = redactLocal(input);
    assert.ok(!r.text.includes(gone), `${input} -> ${r.text}`);
    assert.ok(r.text.includes('[NAME 1]'));
  }
  // Words that are not names are still trimmed from the edges.
  assert.equal(redactLocal('Dear Customer Tan, your account').text, 'Dear Customer [NAME 1], your account');
  assert.equal(redactLocal('Hi Customer, your parcel is waiting.').items.length, 0);
});
