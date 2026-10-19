import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Fake Anthropic Messages API so the real HTTP path (headers, body shape, JSON parsing) is exercised.
test('server -> fake Anthropic API: request shape, untrusted-data wrapping, merge, no key leak', async () => {
  let seen;
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen = { headers: req.headers, url: req.url, body: JSON.parse(b) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        riskLevel: 'high_risk', confidence: 'high', scamCategory: 'bank_or_card_phishing',
        plainEnglish: 'Your bank account has been locked. They want you to click a link to verify.',
        languageNotes: '"kena" means "got" (passive).', summary: 'Strong signs of a bank phishing message.',
        reasons: ['Creates urgency about your account', 'Asks you to verify through a link'],
        suspiciousPhrases: [{ text: 'kena locked', why: 'account lock claim' }, { text: 'phrase the model invented', why: 'x' }],
        missingInfo: [] }) }] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.LLM_PROVIDER = 'anthropic'; process.env.LLM_API_KEY = 'sk-test-SECRET'; process.env.LLM_BASE_URL = `http://127.0.0.1:${fake.address().port}`; process.env.RATE_LIMIT_PER_MIN = '100';
  const { createApp } = await import('../server/index.js');
  const app = await new Promise((r) => { const s = createApp().listen(0, '127.0.0.1', () => r(s)); });
  try {
    const msg = 'Eh, my bank account kena locked. They ask me to click this link and verify.';
    const res = await fetch(`http://127.0.0.1:${app.address().port}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: msg }) });
    const text = await res.text();
    const j = JSON.parse(text);
    assert.equal(seen.url, '/v1/messages');
    assert.equal(seen.headers['x-api-key'], 'sk-test-SECRET');
    assert.match(seen.body.system, /Singlish/); assert.match(seen.body.system, /kena/);
    assert.match(seen.body.messages[0].content, /<message>\nEh, my bank account kena locked/);
    assert.equal(seen.body.temperature, 0);
    assert.equal(j.meta.source, 'ai+rules'); assert.equal(j.meta.degraded, false);
    assert.equal(j.analysis.riskLevel, 'high_risk');
    assert.equal(j.analysis.interpretation.plainEnglish.startsWith('Your bank account'), true);
    assert.deepEqual(j.analysis.suspiciousPhrases.map((p) => p.text).includes('phrase the model invented'), false);
    assert.ok(j.analysis.suspiciousPhrases.some((p) => /kena locked/i.test(p.text)));
    assert.ok(!text.includes('sk-test-SECRET'), 'API key never reaches the client');
    assert.ok(!/system prompt|SYSTEM_PROMPT|You are the scam-analysis engine/.test(text), 'prompt never leaks');
  } finally { app.close(); fake.close(); delete process.env.LLM_API_KEY; delete process.env.LLM_BASE_URL; }
});
