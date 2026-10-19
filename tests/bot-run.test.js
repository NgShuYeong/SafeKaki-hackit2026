import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBot } from '../telegram-bot/bot.js';
import { analyzeMessage } from '../server/core/analyze.js';
import { buildReportDraft } from '../server/core/report.js';

// Real HTTP server pretending to be api.telegram.org, to exercise the actual long-polling loop.
function fakeTelegram({ token = 'GOOD', updates = [] } = {}) {
  const log = [];
  let delivered = false;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = req.url.split('/').pop();
      const ok = req.url.startsWith(`/bot${token}/`);
      const payload = body ? JSON.parse(body) : {};
      log.push({ m, payload, ok });
      res.setHeader('content-type', 'application/json');
      if (!ok) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' })); }
      if (m === 'getUpdates') {
        if (!delivered) { delivered = true; return res.end(JSON.stringify({ ok: true, result: updates })); }
        return setTimeout(() => res.end(JSON.stringify({ ok: true, result: [] })), 100);
      }
      res.end(JSON.stringify({ ok: true, result: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, log, base: `http://127.0.0.1:${srv.address().port}` })));
}
const backend = { mode: 'test', analyze: (i) => analyzeMessage(i, { cfg: { apiKey: '' } }), draft: async (i) => buildReportDraft(i) };

test('run(): registers commands, polls getUpdates over HTTP, replies, and stops on abort', async () => {
  const upd = [{ update_id: 10, message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: "Hi, I'm from the bank. Need your OTP to verify your account." } }];
  const { srv, log, base } = await fakeTelegram({ updates: upd });
  const ctrl = new AbortController();
  const bot = createBot({ token: 'GOOD', apiBase: base, backend, log: () => {} });
  const done = bot.run({ signal: ctrl.signal });
  await new Promise((r) => setTimeout(r, 600));
  ctrl.abort(); await done; srv.close();
  const methods = log.map((l) => l.m);
  assert.ok(methods.includes('deleteWebhook') && methods.includes('setMyCommands'));
  const reply = log.find((l) => l.m === 'sendMessage');
  assert.match(reply.payload.text, /High risk/);
  const polls = log.filter((l) => l.m === 'getUpdates');
  assert.ok(polls.length >= 2); assert.equal(polls[1].payload.offset, 11, 'acknowledges processed updates');
});

test('run(): a wrong token (401) stops cleanly with a helpful log and no crash loop', async () => {
  const { srv, log, base } = await fakeTelegram({ token: 'GOOD' });
  const logs = [];
  const bot = createBot({ token: 'BAD', apiBase: base, backend, log: (m) => logs.push(m) });
  await bot.run({});
  srv.close();
  assert.ok(logs.some((l) => /rejected the bot token/.test(l)));
  assert.ok(!logs.some((l) => l.includes('BAD')), 'token never logged');
});
