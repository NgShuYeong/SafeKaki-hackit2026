import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';

let server, base;
before(async () => {
  process.env.LLM_API_KEY = ''; process.env.ANTHROPIC_API_KEY = ''; process.env.RATE_LIMIT_PER_MIN = '6';
  const app = createApp();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const post = (path, body, raw) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });

test('health never exposes secrets', async () => {
  const j = await (await fetch(base + '/api/health')).json();
  assert.deepEqual(Object.keys(j).sort(), ['llmConfigured', 'ok', 'provider']);
});
test('analyze returns the consistent response shape', async () => {
  const r = await post('/api/analyze', { message: "Hi, I'm from the bank. Need your OTP to verify your account." });
  assert.equal(r.status, 200);
  const j = await r.json();
  for (const k of ['riskLevel', 'headline', 'summary', 'reasons', 'suspiciousPhrases', 'nextSteps', 'original', 'disclaimer', 'scamCategory']) assert.ok(k in j.analysis, k);
  assert.equal(j.analysis.original, "Hi, I'm from the bank. Need your OTP to verify your account.");
});
test('invalid inputs get clear 400s, not stack traces', async () => {
  for (const [body, raw] of [[{}], [{ message: 5 }], [{ message: '   ' }], [null, '{bad json']]) {
    const r = await post('/api/analyze', body, raw);
    assert.equal(r.status, 400);
    const t = await r.text();
    assert.ok(!/at .*\.js|node_modules|Error:/.test(t), 'no stack trace');
  }
});
test('oversized body -> 413', async () => {
  const r = await post('/api/analyze', { message: 'a'.repeat(60000) });
  assert.equal(r.status, 413);
});
test('report draft endpoint + unknown route', async () => {
  const r = await post('/api/report/draft', { message: 'send OTP now', details: { moneyLost: false } });
  const j = await r.json();
  assert.equal(j.report.submitted, false);
  assert.equal((await fetch(base + '/api/nope')).status, 404);
  assert.equal((await post('/api/report/draft', {})).status, 400);
});
test('rate limiting kicks in with Retry-After', async () => {
  let last;
  for (let i = 0; i < 10; i++) last = await post('/api/analyze', { message: 'hello there friend' });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});
