import './env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { analyzeMessage } from './core/analyze.js';
import { buildReportDraft, SHARED_INFO_OPTIONS } from './core/report.js';
import { createLimiter } from './core/ratelimit.js';
import { llmConfig, llmConfigured } from './core/llm.js';
import { RESOURCES } from '../shared/resources.js';
import { redactLocal } from '../shared/redact.js';
import { findNamesWithAi } from './core/redactNames.js';
import { readImage as readImageDefault, ImageError } from './core/readImage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ analyze = analyzeMessage, findNames = findNamesWithAi, readImage = readImageDefault } = {}) {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  app.disable('x-powered-by');
  // Small bodies everywhere, except screenshots (base64 images, up to 8 MB before encoding).
  const smallJson = express.json({ limit: '32kb' });
  const imageJson = express.json({ limit: '12mb' });
  app.use((req, res, next) => (req.path === '/api/read-image' ? imageJson : smallJson)(req, res, next));

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Optional CORS (same-origin by default)
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  // Metadata-only request log. Message bodies are never logged.
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => { if (req.path.startsWith('/api')) console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`); });
    next();
  });

  const perIp = createLimiter({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN) || 12 });
  const daily = createLimiter({ windowMs: 86_400_000, max: Number(process.env.GLOBAL_DAILY_LIMIT) || 5000 });
  const limit = (req, res, next) => {
    const g = daily.check('global');
    if (!g.allowed) return res.status(503).json({ ok: false, code: 'busy', error: 'SafeKaki is very busy today. Please try again tomorrow, or call the ScamShield Helpline 1799.' });
    // The Telegram bot can call this API over HTTP. With the shared secret it may pass a per-user id
    // so one busy chat cannot exhaust the limit for everybody sharing the bot's IP address.
    const secret = process.env.BOT_SHARED_SECRET;
    const trusted = secret && req.get('x-safekaki-secret') === secret && req.get('x-safekaki-client');
    const r = perIp.check(trusted ? `bot:${String(req.get('x-safekaki-client')).slice(0, 40)}` : req.ip);
    if (!r.allowed) { res.setHeader('Retry-After', r.retryAfterSec); return res.status(429).json({ ok: false, code: 'rate_limited', error: `Too many requests. Please wait ${r.retryAfterSec} seconds and try again.` }); }
    next();
  };

  app.get('/api/health', (req, res) => {
    const cfg = llmConfig();
    res.json({ ok: true, llmConfigured: llmConfigured(cfg), provider: cfg.provider });
  });
  app.get('/api/resources', (req, res) => res.json({ ok: true, resources: RESOURCES, sharedInfoOptions: SHARED_INFO_OPTIONS }));

  app.post('/api/analyze', limit, async (req, res) => {
    const { message, userContext } = req.body || {};
    if (typeof message !== 'string') return res.status(400).json({ ok: false, code: 'invalid_input', error: 'Please send the message as text.' });
    const ctx = userContext && typeof userContext === 'object' ? {
      sharedOtp: userContext.sharedOtp === true, sharedCredentials: userContext.sharedCredentials === true,
      transferredMoney: userContext.transferredMoney === true, clickedLink: userContext.clickedLink === true,
    } : {};
    try {
      const result = await analyze({ message, userContext: ctx });
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch {
      res.status(500).json({ ok: false, code: 'internal', error: 'Something went wrong on our side. Please try again, or call the ScamShield Helpline 1799.' });
    }
  });

  app.post('/api/report/draft', limit, (req, res) => {
    const { message, details } = req.body || {};
    if (typeof message !== 'string') return res.status(400).json({ ok: false, code: 'invalid_input', error: 'The original message is needed to prepare a report.' });
    try {
      const r = buildReportDraft({ message, details: details && typeof details === 'object' ? details : {} });
      res.status(r.ok ? 200 : 400).json(r);
    } catch {
      res.status(500).json({ ok: false, code: 'internal', error: 'Could not prepare the report. Please try again.' });
    }
  });

  // "Share safely": the browser hides numbers itself, then asks here for names the rules missed.
  // The text is rule-redacted again on arrival, so nothing sensitive reaches the AI even if a client skips that step.
  app.post('/api/share/names', limit, async (req, res) => {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ ok: false, code: 'invalid_input', error: 'Please send the message as text.' });
    if (text.length > 4000) return res.status(400).json({ ok: false, code: 'too_long', error: 'That message is too long.' });
    const r = await findNames(redactLocal(text).text);
    res.json({ ok: true, names: r.names, usedAI: r.usedAI });
  });

  // Screenshot -> text. The browser sends the image; we return the words so the user can check them before analysis.
  // The image is only held in memory while being read, and is never saved or logged.
  app.post('/api/read-image', limit, async (req, res) => {
    const { image } = req.body || {};
    if (typeof image !== 'string' || !image) return res.status(400).json({ ok: false, code: 'invalid_input', error: 'Please choose a screenshot image.' });
    const b64 = image.replace(/^data:image\/[a-z+.-]+;base64,/i, '');
    try {
      const r = await readImage(Buffer.from(b64, 'base64'));
      res.json({ ok: true, ...r });
    } catch (e) {
      if (e instanceof ImageError) return res.status(e.code === 'too_large' ? 413 : 400).json({ ok: false, code: e.code, error: e.message });
      res.status(500).json({ ok: false, code: 'internal', error: 'Sorry, we could not read that picture. Please paste the text instead.' });
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ ok: false, code: 'not_found', error: 'Not found.' }));

  // Serve the built web app in production (npm run build, then npm run server)
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=300') }));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Never leak stack traces
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, code: 'too_large', error: req.path === '/api/read-image' ? 'That picture is too big. Please use a smaller screenshot (under 8 MB).' : 'That message is too long.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, code: 'invalid_input', error: 'Could not read that request.' });
    res.status(500).json({ ok: false, code: 'internal', error: 'Something went wrong on our side.' });
  });
  return app;
}

// True when run directly (node server/index.js). Compares real paths, so it works on Windows and in folders with spaces.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    const cfg = llmConfig();
    console.log(`SafeKaki API on http://${host}:${port}  |  LLM: ${llmConfigured(cfg) ? `${cfg.provider}/${cfg.model}` : 'NOT CONFIGURED (rules-only fallback)'}`);
  });
}
