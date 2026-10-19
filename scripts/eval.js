// Evaluation: naive keyword baseline  vs  SafeKaki rules layer  vs  (if a key is set) full AI+rules.
// Usage: npm run eval
// Note: the project's ORIGINAL detector was not part of the uploaded zip, so the baseline below is a
// stand-in for a simple English-only keyword detector, not a measurement of your old code.
import '../server/env.js';
import fs from 'node:fs';
import { analyzeMessage } from '../server/core/analyze.js';
import { llmConfigured, llmConfig } from '../server/core/llm.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/testset.json', import.meta.url)));
const ACCEPT = { scam: ['high_risk', 'suspicious'], legit: ['insufficient_evidence'], ambiguous: ['suspicious', 'insufficient_evidence'] };

const KW = /\b(otp|click|verify|blocked|locked|suspended|urgent|pay|transfer|account|password|refund|prize|winner|link)\b/i;
const baseline = async (m) => ({ level: KW.test(m) ? 'suspicious' : 'insufficient_evidence' });
const rules = async (m) => ({ level: (await analyzeMessage({ message: m }, { cfg: { apiKey: '' } })).analysis.riskLevel });
const full = async (m) => { const r = await analyzeMessage({ message: m }); return { level: r.analysis.riskLevel, degraded: r.meta.degraded }; };

async function run(name, fn) {
  const rows = [];
  for (const d of data) { const r = await fn(d.text); rows.push({ ...d, level: r.level, pass: ACCEPT[d.truth].includes(r.level) }); }
  const by = (f) => rows.filter(f);
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a');
  const scams = by((r) => r.truth === 'scam'), legit = by((r) => r.truth === 'legit'), amb = by((r) => r.truth === 'ambiguous');
  console.log(`\n=== ${name} ===`);
  console.log(`Scams flagged (recall):            ${scams.filter((r) => r.pass).length}/${scams.length} (${pct(scams.filter((r) => r.pass).length, scams.length)})`);
  console.log(`  High-risk (strong) on scams:     ${scams.filter((r) => r.level === 'high_risk').length}/${scams.length}`);
  for (const lang of ['english', 'singlish', 'mixed']) { const g = scams.filter((r) => r.lang === lang); if (g.length) console.log(`  ${lang.padEnd(9)} scams flagged:      ${g.filter((r) => r.pass).length}/${g.length}`); }
  console.log(`Legit wrongly flagged (FP):        ${legit.filter((r) => !r.pass).length}/${legit.length} (${pct(legit.filter((r) => !r.pass).length, legit.length)})`);
  console.log(`Ambiguous called "high risk":      ${amb.filter((r) => r.level === 'high_risk').length}/${amb.length}`);
  const misses = rows.filter((r) => !r.pass);
  if (misses.length) { console.log('Misses:'); misses.forEach((r) => console.log(`  [${r.truth} -> ${r.level}] ${r.id}: ${r.text.slice(0, 80)}`)); }
  return rows;
}

await run('Naive keyword baseline (stand-in for an English-only detector)', baseline);
await run('SafeKaki rules layer only (no AI)', rules);
if (llmConfigured()) {
  const cfg = llmConfig();
  console.log(`\nRunning the full AI+rules pipeline on ${data.length} messages with ${cfg.provider}/${cfg.model}...`);
  await run(`SafeKaki AI + rules (${cfg.provider}/${cfg.model})`, full);
} else {
  console.log('\nAI + rules: SKIPPED (no LLM_API_KEY set). Set one in .env and re-run to measure the real pipeline.');
}
