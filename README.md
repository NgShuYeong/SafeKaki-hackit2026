# SafeKaki

Scam help for Singapore, built for people who are not tech-savvy. Paste a suspicious message (English, Singlish or mixed languages), see why it looks risky, prepare a scam report, and warn family with private details hidden. Also available as a Telegram bot.

This build merges the 13 Oct SafeKaki build with two features from the 12 Oct SafeAlerts build: **Warn family safely** (hiding private details) and **voice input**.

```
 React web app ──┐
                 ├──►  server/core  (preprocess → rules → LLM → merge → report)  ──► LLM provider
 Telegram bot ───┘          one shared codebase for both
```

## Quick start

Requires Node 20+.

```bash
npm install
cp .env.example .env        # then edit .env (see below)
npm run dev:all             # web app on http://localhost:5173, API on http://127.0.0.1:8787
```

Without an LLM key the app still works in **rules-only mode** and tells the user so. Add a key for full Singlish understanding.

Production: `npm run build` then `npm run server`. The server serves `dist/` and the API on one port.

## Environment variables (`.env`, never committed)

| Variable | Needed | Purpose |
|---|---|---|
| `LLM_PROVIDER` | no | `anthropic` (default) or `openai` (any OpenAI-compatible API) |
| `LLM_API_KEY` | for AI mode | Your provider key. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` also work |
| `LLM_MODEL` | no | Default `claude-haiku-5-5` (anthropic) or `gpt-4o-mini` (openai). Check your provider's current model names |
| `LLM_BASE_URL` | no | For a proxy or compatible provider |
| `PORT`, `HOST` | no | API server, default `127.0.0.1:8787` |
| `RATE_LIMIT_PER_MIN` | no | Per-IP limit, default 12 |
| `GLOBAL_DAILY_LIMIT` | no | Overall daily cap, default 5000 (protects your LLM bill) |
| `TRUST_PROXY` | behind a proxy | e.g. `1`, so per-IP limits use the real client IP |
| `TELEGRAM_BOT_TOKEN` | for the bot | From @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | no | Comma-separated allow-list; blank = anyone |
| `BOT_RATE_LIMIT_PER_MIN` | no | Per-user bot limit, default 8 |
| `SAFEKAKI_API_URL`, `BOT_SHARED_SECRET` | no | Run the bot against a remote API instead of in-process (see below) |
| `VITE_TELEGRAM_BOT_URL` | no | Shows a "use SafeKaki on Telegram" link on the home screen |

## The Telegram bot

1. In Telegram, open **@BotFather** → `/newbot` → pick a name and a username ending in `bot`. Copy the token it gives you.
2. Put it in `.env` as `TELEGRAM_BOT_TOKEN=...`. **Never commit it or paste it in code.** If it leaks, use `/revoke` in BotFather.
3. Run: `npm run bot`. Open your bot in Telegram and send `/start`.

It uses Telegram's official Bot API with long polling, so it needs no public URL and works on a laptop.
By default the bot imports the same `server/core` code in-process. To run it separately, start the API (`npm run server`), then set `SAFEKAKI_API_URL=http://127.0.0.1:8787` and a matching `BOT_SHARED_SECRET` in both processes so each Telegram user gets their own rate limit.

Send a message, forward one, or send a screenshot. Commands: `/start`, `/report`, `/share` (hide private details to warn family), `/scammed` (urgent help), `/tips`, `/privacy`, `/cancel`. Or just paste or forward a message.
Only private chats are answered. Group chats and other bots are ignored.

## What happens to messages and personal data

- A message you submit is sent to this server and then to the configured LLM provider to be analysed. Check your provider's data terms.
- The web app keeps the message in browser memory only. Nothing goes to cookies, localStorage or a database.
- The Telegram bot holds a message in server memory for up to 30 minutes, only so it can prepare a report. `/cancel` deletes it immediately.
- Server logs record method, path, status and timing. **Never message content.**
- URLs in messages are parsed as text. They are never opened or fetched.
- SafeKaki never contacts the police, ScamShield or a bank for the user. Reports are **prepared**, then the user copies them or opens the official page and submits them personally. The UI and bot say "prepared, not submitted" throughout.

## Warn family safely

`shared/redact.js` hides names, phone numbers, NRIC/FIN, card numbers, bank accounts, OTPs, emails and addresses, and labels them `[PHONE 1]`, `[NAME 2]` and so on. Links are kept on purpose so others can recognise the same scam, and official numbers (999, 995, 1799) are left alone.

- The rules run in the browser (and in the bot), so numbers never need to leave the device.
- If an LLM key is set, `POST /api/share/names` asks the AI for names the rules missed. The server rule-redacts the text again on arrival, so the AI never sees numbers even if a client skips that step. Without a key it is rules-only and tells the user to re-read.
- Web: the **Share** tab, the "Warn family safely" button after a check, and a ready-to-send family message (copy or WhatsApp).
- Telegram: `/share`, or the "Warn family safely" button under each result.

## Screenshots

People can send a **screenshot** instead of typing: on the website (Upload a screenshot, or paste an image into the message box) and in Telegram (send a photo, or an image as a file).

- `server/core/readImage.js` reads the words out of the picture. With an LLM key it uses the AI's vision (best for chat bubbles, emoji and mixed languages). Without one, or if the AI fails, it uses free offline OCR (`tesseract.js`, English data bundled in `node_modules`, so no internet or key is needed).
- The words are shown back to the user first, so they can fix any misreads before the check.
- PNG, JPG and WebP, up to 8 MB. The type is checked from the file's bytes. Images are held in memory only while being read and are never saved or logged.
- API: `POST /api/read-image` with `{ "image": "<base64 or data URL>" }` returns `{ ok, text, method }` (`method` is `ai` or `ocr`).

## Voice input

A **Speak instead** button on Check, Share and the report's "what happened" box uses the browser's speech recognition (`en-SG`). It only appears in browsers that support it (Chrome, Edge, Safari).

## How detection works

1. **Preprocess** (`server/core/preprocess.js`): cleans control characters, extracts links, phone numbers, emails and amounts, flags Singlish terms with their meanings. The original text is kept and never replaced.
2. **Rules** (`heuristics.js`): weighted signals for OTP or credential requests, impersonation, urgency, threats, payment requests, remote access, lookalike links, plus basic Chinese and Malay patterns. Singlish particles (*lah, leh, lor, anot*) are deliberately **not** signals. "Do not share your OTP" is not treated as a request.
3. **LLM** (`prompt.js`, `llm.js`): a system prompt that teaches Singlish reading rules, three honest risk levels, "never say safe", and treats the message as untrusted data. The model sees the original message plus the extracted hints.
4. **Merge** (`analyze.js`): the LLM has the final say, but strong rule signals raise a too-lenient result. Quoted phrases that do not appear in the original message are dropped. Next-step advice comes from fixed, reviewed text, not from the model, so it can never tell a user to call a number from the scam.
5. If the LLM fails, the app falls back to rules and says so.

Risk levels: **High risk**, **Suspicious**, **Not enough evidence** (never "safe").

## Tests

```bash
npm test          # 58 backend, API, Telegram, share and screenshot tests (node:test)
npm run test:ui   # 20 UI tests: real React app against the real API in a simulated browser (vitest)
npm run eval      # accuracy on data/testset.json: keyword baseline vs rules (vs AI if a key is set)
```

To test the reporting workflow by hand: run `npm run dev:all`, open Check a message, paste `Hi, I'm from the bank. Need your OTP now. Click dbs-sg-verify.top/login`, then tap **Prepare a report**. Answer the questions, edit fields, tick the confirmation box and open the official pages.

## Official resources used

Verified against scamshield.gov.sg and police.gov.sg when this was written. They live in one file, `shared/resources.js`. **Re-check them before launch.**

- ScamShield Helpline **1799** (24/7; can connect to banks; cannot file police reports) and https://www.scamshield.gov.sg
- SPF online police report: https://eservices1.police.gov.sg/phub/eservices/landingpage/police-report

There is no known official API for submitting reports on a user's behalf, so none is used.

## Project layout

```
shared/          resources + report formatter (used by web, API and bot)
server/core/     preprocess, heuristics, prompt, llm, analyze, report, ratelimit
server/index.js  Express API
telegram-bot/    bot.js, backend.js, format.js
src/             React app (screens/, components/)
tests/, data/, scripts/eval.js
firestore.rules  unchanged from your upload
```

## Before going public

- Add monitoring and a real rate-limit store (Redis) if you run more than one server instance.
- Have a person review the system prompt and the help content, ideally with seniors and a scam-response professional.
- Add translations (Chinese, Malay, Tamil) for the UI if you want to serve those communities fully.
