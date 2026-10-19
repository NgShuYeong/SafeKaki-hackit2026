// Screenshot support: image -> text (AI vision or free offline OCR), web API and Telegram photos.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readImage, sniffImageType, cleanOcrText, closeOcr, ImageError } from '../server/core/readImage.js';
import { callLlm } from '../server/core/llm.js';
import { createApp } from '../server/index.js';
import { createBot } from '../telegram-bot/bot.js';
import { analyzeMessage } from '../server/core/analyze.js';

const PNG = fs.readFileSync(new URL('./fixtures/scam-chat.png', import.meta.url));
after(() => closeOcr());

test('image type is detected from the bytes, not the file name', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('not an image at all')), null);
});
test('OCR clean-up drops timestamps, fixes "|" for "I" and rejoins wrapped lines', () => {
  assert.equal(cleanOcrText('Can you help me\n| need it today, | return you\n\n10:42\nOK\n\n9:05 PM ✓✓\n'), 'Can you help me I need it today, I return you\nOK');
});
test('free offline OCR reads a real dark-mode chat screenshot (no AI key, no internet)', async () => {
  const r = await readImage(PNG, { cfg: { apiKey: '' } });
  assert.equal(r.method, 'ocr');
  for (const words of ['new number', 'transfer', '$1,200', '501-234567-001', "Don't call"]) assert.ok(r.text.includes(words), words);
  assert.ok(!/10:4\d/.test(r.text), 'timestamps removed');
});
test('AI vision is used when a key is set, and the request carries the image', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"text":"Hi Ma, this is my new number"}' }] }) }; };
  const cfg = { provider: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'http://llm.local', timeoutMs: 5000 };
  const r = await readImage(PNG, { cfg, llm: (p, images) => callLlm(p, { cfg, fetchImpl, images, system: 'x' }) });
  assert.deepEqual(r, { text: 'Hi Ma, this is my new number', method: 'ai' });
  const content = body.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/png');
});
test('if the AI fails, it falls back to offline OCR', async () => {
  const r = await readImage(PNG, { llm: async () => { throw new Error('down'); } });
  assert.equal(r.method, 'ocr');
  assert.match(r.text, /transfer/);
});
test('bad input gets friendly errors', async () => {
  await assert.rejects(readImage(Buffer.from('hello world, not a picture')), (e) => e instanceof ImageError && e.code === 'unsupported');
  await assert.rejects(readImage(Buffer.alloc(9 * 1024 * 1024, 1)), (e) => e.code === 'too_large');
  await assert.rejects(readImage(PNG, { cfg: { apiKey: '' }, ocr: async () => ({ text: ' . ', confidence: 10 }) }), (e) => e.code === 'no_text');
});

test('API /api/read-image returns the words; rejects non-images', async () => {
  process.env.LLM_API_KEY = ''; process.env.ANTHROPIC_API_KEY = '';
  const app = createApp();
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(base + '/api/read-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const ok = await post({ image: 'data:image/png;base64,' + PNG.toString('base64') });
    const j = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(j.method, 'ocr');
    assert.match(j.text, /501-234567-001/);
    const bad = await post({ image: Buffer.from('plain text').toString('base64') });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /PNG or JPG/);
    // normal endpoints keep their small body limit
    const big = await fetch(base + '/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(40000) }) });
    assert.equal(big.status, 413);
  } finally { server.close(); }
});

// Mock of Telegram's Bot API, including getFile and the file download URL.
function mockTelegram() {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes('/file/botT/')) return { ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
    const method = url.split('/').pop();
    const body = JSON.parse(opts.body || '{}');
    calls.push({ method, body });
    if (method === 'getFile') return { status: 200, json: async () => ({ ok: true, result: { file_id: body.file_id, file_path: 'photos/file_1.png', file_size: PNG.length } }) };
    return { status: 200, json: async () => ({ ok: true, result: true }) };
  };
  return { calls, fetchImpl, sent: () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body) };
}
const backend = {
  mode: 'test',
  analyze: (i) => analyzeMessage(i, { cfg: { apiKey: '' } }),
  draft: async () => ({ ok: false }),
  findNames: async () => ({ ok: true, names: [] }),
  readImage: async ({ image }) => ({ ok: true, ...(await readImage(image, { cfg: { apiKey: '' } })) }),
};
const photoMsg = { update_id: 1, message: { message_id: 1, chat: { id: 9, type: 'private' }, from: { id: 9, is_bot: false }, photo: [{ file_id: 'small', width: 90, height: 70, file_size: 900 }, { file_id: 'big', width: 840, height: 660, file_size: PNG.length }] } };

test('bot: a screenshot is read, shown back, then checked like a typed message', async () => {
  const tg = mockTelegram();
  const bot = createBot({ token: 'T', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend, log: () => {} });
  await bot.handleUpdate(photoMsg);
  assert.equal(tg.calls.find((c) => c.method === 'getFile').body.file_id, 'big', 'uses the largest photo size');
  const texts = tg.sent().map((m) => m.text);
  assert.ok(texts.some((t) => /Reading your screenshot/.test(t)));
  assert.ok(texts.some((t) => /Here is what I read/.test(t) && /501-234567-001/.test(t)));
  const result = tg.sent().at(-1);
  assert.match(result.text, /warning signs|strong signs/i);
  assert.ok(result.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'sh:go'));
});
test('bot: /share then a screenshot gives the hidden-details version', async () => {
  const tg = mockTelegram();
  const bot = createBot({ token: 'T', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend, log: () => {} });
  await bot.handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 9, type: 'private' }, from: { id: 9, is_bot: false }, text: '/share' } });
  await bot.handleUpdate(photoMsg);
  const t = tg.sent().at(-1).text;
  assert.match(t, /Safe to share/);
  assert.match(t, /\[BANK ACCT 1\]/);
  assert.ok(!t.includes('501-234567-001'));
});
test('bot: stickers and voice notes get a clear "text or screenshot" reply', async () => {
  const tg = mockTelegram();
  const bot = createBot({ token: 'T', fetchImpl: tg.fetchImpl, apiBase: 'http://tg.local', backend, log: () => {} });
  await bot.handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 9, type: 'private' }, from: { id: 9, is_bot: false }, voice: { file_id: 'v' } } });
  assert.match(tg.sent().at(-1).text, /screenshot/);
});
