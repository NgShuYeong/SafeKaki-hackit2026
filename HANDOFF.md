# SafeKaki: project handoff (19 Oct 2026)

## Project
SafeKaki is an anti-scam helper for Singapore, built for the Hackit2026 hackathon. It is a React website plus a Telegram bot, sharing one Node/Express server.

- **Current code:** `C:\HACKIT\SafeKaki-merged`
- **Old versions (untouched):** `C:\HACKIT\Hackit2026` is the 12 Oct "SafeAlerts" build. The 13 Oct "SafeKaki" build came as a zip (`Hackit2026-main_3.zip`).

## Features
- **Check a message:** paste text, upload a screenshot, or speak. It understands Singlish and gives three risk levels: High risk, Suspicious, or Not enough evidence (never "safe"). It highlights the risky phrases and gives next steps.
- **Screenshots:** the text is read by AI vision if an AI key is set, otherwise by free offline OCR (tesseract.js). The words read are shown to the user to check before analysis. Accepts PNG, JPG and WebP up to 8 MB, never saved.
- **Report:** prepares a scam report for the user to submit themselves. Nothing is sent automatically.
- **Warn family safely:** hides names, phone numbers, NRIC, card and bank numbers, OTPs, emails and addresses, keeps links, and gives a family message to copy or send on WhatsApp. Brought back from the 12 Oct build.
- **Voice input:** a "Speak instead" button, also from the 12 Oct build.
- **Telegram bot:** accepts text, forwarded messages and screenshots. Commands: `/start`, `/report`, `/share`, `/scammed`, `/tips`, `/privacy`, `/cancel`.
- **Rate limit:** 8 message checks a minute per person (`BOT_RATE_LIMIT_PER_MIN`). Button taps don't count.

## Key files
- `server/core/` holds the checking code: `analyze`, `heuristics`, `llm`, `prompt`, `report`, `readImage` (screenshots) and `redactNames`.
- `shared/redact.js` hides private details.
- `telegram-bot/` has `bot.js`, `backend.js` and `format.js`.
- `src/screens/` has the Home, Check, Report, Share, Help and Learn screens.
- `tests/`: 58 backend tests (`npm test`) and 20 UI tests (`npm run test:ui`), all passing.

## `.env` (in `C:\HACKIT\SafeKaki-merged`, never share or commit it)
```
TELEGRAM_BOT_TOKEN=<token from BotFather>
LLM_PROVIDER=anthropic
LLM_API_KEY=
```
- An empty `LLM_API_KEY` means rules-only mode. Add a key for better Singlish understanding and screenshot reading.
- Optional: `VITE_TELEGRAM_BOT_URL=https://t.me/<botusername>` shows a Telegram link on the website.

## How to run
```
cd C:\HACKIT\SafeKaki-merged
npm install          (once, or after new libraries are added)
npm run bot          (Telegram bot, keep the window open)
npm run dev:all      (website at http://localhost:5173, in a second window)
```

## Where things stand (19 Oct)
- **The bot won't start yet:** Telegram rejects the token (401). `.env` still has the 16 Oct token, which no longer works after the new bot was made.
  - **Next step:** copy the new bot's token from BotFather (`/mybots` → bot → API Token) into `.env`, then run `npm run bot`.
- **Bot name:** SafeKaki. A bot's @username can't be changed, so a new bot was made for the @ you wanted.
- **Avoid** official-sounding names like "ScamShield", "SPF" or "Gov".

### BotFather texts (ready to paste)
**About** (`/setabouttext`):
```
Your scam-check buddy 🛡️ Send a suspicious message or screenshot and I'll point out the warning signs. Singlish OK!
```
**Description** (`/setdescription`):
```
Got a message that doesn't feel right? 🤔

Send it to me and I'll check it for scam warning signs. You can paste the text, forward the message, or send a screenshot. English, Singlish and mixed languages are all OK.

I can also:
🔒 Hide names and numbers so you can warn your family safely
📝 Help you prepare a scam report
🚨 Tell you what to do first if you already sent money or shared an OTP

Not sure? Call the free ScamShield Helpline 1799.
```

## Known issues and ideas
- Without an AI key, the rule checks sometimes give the wrong scam type. For example, a "Hi Mum, new number" scam is flagged correctly but labelled "Bank or card phishing".
- `npm install` reports 24 vulnerabilities in packages (11 moderate, 11 high, 2 critical). Don't run `npm audit fix --force`.
- If the website complains about esbuild, run `npm approve-scripts esbuild`, then `npm install`.
- Firebase and `firestore.rules` are left over and unused. They could be used for a scam wall or family alerts later.
- The old token was leaked in an earlier zip. Keep tokens out of zips and chats.
