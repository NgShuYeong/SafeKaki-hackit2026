# SafeKaki: project handoff (20 Oct 2026)

## Project
SafeKaki is an anti-scam helper for Singapore, built for the Hackit2026 hackathon. It is a React website plus a Telegram bot, sharing one Node/Express server.

- **Current code:** `C:\HACKIT\SafeKaki-merged` (GitHub: `NgShuYeong/SafeKaki-merged`, branch `main`)
- **Old versions (untouched):** `C:\HACKIT\Hackit2026` is the 12 Oct "SafeAlerts" build. The 13 Oct "SafeKaki" build came as a zip (`Hackit2026-main_3.zip`).

## Features
- **Check a message:** paste text, upload a screenshot, or speak. It understands Singlish and gives three risk levels: High risk, Suspicious, or Not enough evidence (never "safe"). It highlights the risky phrases and gives next steps.
- **Screenshots:** the text is read by AI vision if an AI key is set, otherwise by free offline OCR (tesseract.js). The words read are shown to the user to check before analysis. Accepts PNG, JPG and WebP up to 8 MB, never saved.
- **Report:** prepares a scam report for the user to submit themselves. Nothing is sent automatically.
- **Warn family safely:** hides names, phone numbers, NRIC, card and bank numbers, OTPs, emails and addresses, keeps links, and gives a family message to copy or send on WhatsApp.
- **Voice input:** a "Speak instead" button on the website.
- **Kaki discussion rooms (new, 19 Oct, Telegram only):** see the section below.
- **Telegram bot:** accepts text, forwarded messages and screenshots. Commands: `/start`, `/report`, `/share`, `/scammed`, `/discuss`, `/kaki`, `/rooms`, `/leave`, `/end`, `/tips`, `/privacy`, `/cancel`.
- **Rate limit:** 8 message checks a minute per person (`BOT_RATE_LIMIT_PER_MIN`). Button taps don't count.

## Kaki discussion rooms
When the bot can't be sure, the user can ask other people. **Kakis** are users who opted in with `/kaki` to help.

**How it works**
1. After a check, the user taps **🗣 Discuss with Kakis** (or types `/discuss`).
2. The message is redacted (same rules as Warn family) and links are made unclickable (`hxxps://dbs-x[.]test`). The user sees a preview and taps **Open the room**.
3. Up to 8 free Kakis are pinged by DM, least recently pinged first. They tap **Join**. Kakis can also see open rooms with `/rooms`.
4. Everyone gets a made-up name ("Asker", "Kaki 1", "Kaki 2"). Telegram names and numbers are never shown.
5. Anything typed in the room is redacted and copied to everyone else. Text only, no photos. Other commands are paused until `/leave`.
6. Room buttons: **🗳 Vote** (Scam / Not sure / Looks real), **⚠️ Report someone**, **🚪 Leave**. Leaving asks for a vote first if the person hasn't voted.
7. The room closes when the last person leaves, after **20 quiet minutes**, after **1 hour**, or when the asker types `/end`.
8. Everyone who took part gets a **summary** (vote count, key points from the chat, next steps). The chat is then deleted.

**Why it is built this way**
- Telegram bots can't create group chats, so a room lives inside each person's private chat with the bot, and the bot passes messages between them.
- Rooms are kept in memory only. **Restarting the bot ends all open rooms** (no summary is sent for them).

**Safety rules**
- The vote line is worked out in code. A summary can never say "safe", and "Looks real" votes can't override the bot's High risk result.
- With an AI key, the AI writes the key points, and any point that sounds reassuring ("safe", "legit", "genuine") is dropped. Without a key, the key points list the warning signs people mentioned in the chat.
- Max 6 people per room. 2 reports remove a person, and they can't rejoin.
- Limits per person: 3 new rooms an hour, 20 room messages a minute.
- If no Kakis are free, the room isn't opened and the user is pointed to the 1799 helpline.

**What is saved** (both files are in `.gitignore`)
- `data/kakis.json`: Telegram user IDs of Kakis. `/kaki` → "Stop being a Kaki" removes the ID.
- `data/room-summaries.json`: closing summaries (redacted message, votes, key points). No chat log and no user IDs. Last 500 kept.
- `/privacy` in the bot explains all of this to users.

**Tuning:** limits are constants at the top of `telegram-bot/rooms.js` (`ROOM_IDLE_MS`, `ROOM_MAX_MS`, `ROOM_MAX_PEOPLE`, `REPORTS_TO_REMOVE`, `MAX_ROOM_MESSAGE`). The rooms-per-hour and messages-per-minute limits are in `telegram-bot/bot.js` (`roomOpenLimiter`, `roomChatLimiter`). `SAFEKAKI_DATA_DIR` in `.env` changes where the data files go.

## Key files
- `server/core/` holds the checking code: `analyze`, `heuristics`, `llm`, `prompt`, `report`, `readImage` (screenshots), `redactNames` and `summarize` (room summaries).
- `shared/redact.js` hides private details.
- `telegram-bot/` has `bot.js`, `backend.js`, `format.js` (all bot texts) and `rooms.js` (discussion rooms).
- `src/screens/` has the Home, Check, Report, Share, Help and Learn screens.
- `tests/`: 69 backend tests (`npm test`, 11 of them in `rooms.test.js`) and 20 UI tests (`npm run test:ui`).

## `.env` (in `C:\HACKIT\SafeKaki-merged`, never share or commit it)
```
TELEGRAM_BOT_TOKEN=<token from BotFather>
LLM_PROVIDER=anthropic
LLM_API_KEY=
```
- An empty `LLM_API_KEY` means rules-only mode. Add a key for better Singlish understanding, screenshot reading and room summaries.
- Optional: `VITE_TELEGRAM_BOT_URL=https://t.me/<botusername>` shows a Telegram link on the website.
- Optional: `SAFEKAKI_DATA_DIR=<folder>` to store `kakis.json` and `room-summaries.json` somewhere other than `data/`.
- Optional: `SAFEKAKI_WEBSITE_URL=<address>` makes the bot show a link to the website (welcome, Help, 🌐 Website button, `/website`).
- Optional: `DEMO_KAKIS=1` turns on demo mode (see "Demoing the rooms"). `DEMO_KAKIS_DELAY_MS` sets the pause between steps (default 3500).

## How to run
```
cd C:\HACKIT\SafeKaki-merged
npm install          (once, or after new libraries are added)
npm run bot          (Telegram bot, keep the window open)
npm run dev:all      (website at http://localhost:5173, in a second window)
```

## Demoing the rooms
- **With one phone (easiest):** type `/demo` in the bot and pick one:
  - **📩 Demo as the asker:** turns on pretend Kakis for your own rooms only. Tap **📩 Use a sample scam message** (or send your own), then 🗣 Discuss with Kakis → Open the room. 2 pretend Kakis join, chat, vote and leave. `/demo` → **🛑 Turn demo off** to stop it. A bot restart also turns it off.
  - **🙋 Demo as a Kaki:** a pretend asker opens a room (a fake Shopee job scam) and pings you. Tap Join and chat. The pretend asker replies to what you type, and a pretend Kaki 2 joins. You don't need to be a Kaki for this.
  - `/demo` is not in the command menu. A room with only pretend people left in it closes by itself.
- **For everyone's rooms:** add `DEMO_KAKIS=1` to `.env` and restart the bot. Every new room then gets 2 pretend Kakis, "Kaki 1 (demo)" and "Kaki 2 (demo)". They join a few seconds apart, comment on the message, vote and leave. Then vote and `/leave` yourself to get the summary. Real Kakis are still pinged and can join too. Summaries from demo rooms are saved with `"demo": true`. Turn it off again after judging.
- **With two phones:** you need **two Telegram accounts** (two phones, or a phone plus Telegram Desktop).
- On the second account: open the bot, tap Start, then `/kaki` → **Join as a Kaki**. Telegram doesn't let bots message people who haven't started them.
- Suggested flow: forward a fake "DBS account blocked" message → 🔴 High risk → **Discuss with Kakis** → second phone gets pinged and joins → chat → both vote and `/leave` → summary appears on both phones.
- To close a room quickly, the asker can type `/end`.

## Changes on 20 Oct (afternoon)
- **"Ah" names fixed:** "Mr Tan Ah Kow", "Hi Ah Huat" and "Uncle Ah Seng" are now hidden in full without an AI key.
- **Demo Kakis:** see "Demoing the rooms".
- **Bot buttons:** `/start` shows big buttons that stay at the bottom of the chat (🔍 Check a message, 🗣 Ask Kakis, 🚨 I got scammed, 🔒 Warn family, ❓ Help, and 🌐 Website if a website address is set). The welcome message is now 3 short steps, and the full list moved to ❓ Help (`/help`). `/scammed` also works from inside a room.
- **Room buttons at the bottom:** in a room, the bottom buttons switch to 🗳 Vote, ⚠️ Report someone and 🚪 Leave room, so nobody has to scroll up in a long chat. The normal buttons come back after leaving, on the summary, or if removed.
- **Voice notes:** they get a clear "I can't listen to voice notes yet" reply that mentions 1799.
- **Website:** a text size button in the header (Normal, Large, Extra large, remembered on that device), a 🔊 "Read this out loud" button on results, and an "Ask other people (Kakis)" card on Home and on results. The card only shows when `VITE_TELEGRAM_BOT_URL` is set.
- Tests: 78 backend and 23 UI, all passing.

## Where things stand (20 Oct)
- **Discussion rooms are done and tested.** All 69 backend tests pass. The UI tests weren't re-run after the change (no website files were touched); run `npm run test:ui` to confirm.
- **Committed but not pushed:** the commit "changed to add community feature" is on local `main`, one commit ahead of GitHub. Run `git push` to back it up.
- **The bot has run since the token fix:** one Kaki is already saved in `data/kakis.json`.
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
🗣 Open a chat room where other users help you decide
🚨 Tell you what to do first if you already sent money or shared an OTP

Not sure? Call the free ScamShield Helpline 1799.
```
The command list in Telegram updates by itself when the bot starts (`setMyCommands`).

## Known issues
- Without an AI key, the rule checks sometimes give the wrong scam type. For example, a "Hi Mum, new number" scam is flagged correctly but labelled "Bank or card phishing".
- Restarting the bot ends open rooms without sending a summary.
- `npm install` reports 24 vulnerabilities in packages (11 moderate, 11 high, 2 critical). Don't run `npm audit fix --force`.
- If the website complains about esbuild, run `npm approve-scripts esbuild`, then `npm install`.
- The old token was leaked in an earlier zip. Keep tokens out of zips and chats.

## Ideas for later
- **"Others got this too":** compare new checks with saved room summaries ("this message was discussed 3 times, most said scam").
- **Family circle:** link a family member who gets pinged when a parent's check comes back High risk.
- **Trusted Kaki badges:** helpers whose votes match the outcome count for more.
- **Scam wall on the website**, built from `room-summaries.json`. Firebase and `firestore.rules` are left over and unused, and could store this.
