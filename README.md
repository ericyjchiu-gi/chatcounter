# ChatGPT Message Meter

Current development version: **v1.5.0**

A Chrome/Chromium extension that reconstructs **ChatGPT Chat** usage from account conversation history, keeps a persistent local metadata cache, and applies conservative plan-aware quota logic where the account tier can be identified safely.

## Current features

- Persistent `chrome.storage.local` cache
- Incremental sync based on conversation `update_time`
- **Single-flight sync**: closing/reopening the panel never starts a second scan while one is already running
- 15-minute automatic refresh cooldown after a completed sync
- Interrupted initial syncs are resumable: progressive cache saves do **not** falsely mark the sync complete
- Conservative pacing and retry/backoff for `429` / `5xx`
- 24 hour / 7 day / 30 day trend dashboard; 24 hours is the default
- Dashboard model families:
  - GPT-5.6
  - GPT-5.6 Pro
  - GPT-6 Pro
- Raw model slug + reasoning effort detail table
- Account-scoped cache
- Up to 90 days of message metadata retained locally, with a 45-day quota fallback

## Account-plan detection

The extension detects the current ChatGPT account plan from `/api/auth/session` fields and, when necessary, the access token's `https://api.openai.com/auth.chatgpt_plan_type` claim. The detected plan is cached per account scope so the UI can render it immediately on reopen.

Known backend plan slugs include `free`, `go`, `plus`, `prolite`, `pro`, Business variants, Enterprise variants, and Edu variants. Unknown/new slugs remain analytics-only rather than receiving a guessed quota.

### Plan-aware Chat quota rules currently implemented

These rules apply **only to Chat**, not Codex/Work:

- **Pro 20x (`pro`)**
  - GPT-6 Pro: 200/week
  - GPT-5.6 Pro: 170/day
  - GPT-6 Pro + GPT-5.6 Pro combined: 200/day
- **Pro 5x (`prolite`)**
  - GPT-6 Pro + GPT-5.6 Pro share 50/week
- **Business Premium**
  - Shared Pro bucket: 50/week, but only when an explicit Premium seat signal is detected
- **Business Standard**
  - Shared Pro bucket: 15/month, but only when an explicit Standard seat signal is detected
- **Free / Go / Plus / Enterprise / Edu / unknown Business seat**
  - Analytics are shown, but no numeric cap is guessed unless a safe rule is available

Because Chat reset anchors are not always exposed, weekly/daily quota displays use rolling windows as conservative usage upper bounds. Therefore the displayed `guaranteed remaining ≥ X` is a lower bound on remaining quota when the history reconstruction is complete.

An optional weekly reset anchor can still be entered in Settings for comparison. It is explicitly treated as an assumption unless ChatGPT exposes a real Chat reset timestamp.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder.
6. Refresh `https://chatgpt.com`.
7. Click the **Meter** pill at the bottom-right.

For future updates, keep using the same unpacked-extension folder and click **Reload** in `chrome://extensions`; this preserves the extension ID and local cache.

## Security model

The extension reads ChatGPT's web `accessToken` from `/api/auth/session` into JavaScript memory because current private history endpoints require bearer authentication. The token is never displayed, exported, logged, written to `chrome.storage`, or sent anywhere other than `chatgpt.com`.

The persistent cache stores only:

- message ID
- timestamp
- raw model slug
- reasoning/thinking effort
- conversation update timestamp/source
- detected account plan metadata

No chat text is cached.

## Important limitation

This is a reconstruction from server-side conversation history, **not OpenAI's official quota ledger**. Temporary/deleted chats, failed generations, hidden quota-bearing events, or private endpoint changes can create discrepancies.

## v1.5.0

- Keeps and hardens the v1.4.1 session/panel reload fix.
- Closing/reopening the Meter attaches to an existing page-level sync instead of launching another one.
- Partial cache checkpoints no longer update `lastSync`; after a hard page reload, an interrupted initial sync resumes incrementally instead of being mistaken for a completed refresh.
- Adds account type detection and a plan badge.
- Adds plan-aware quota safety logic for Pro 20x and Pro 5x.
- Applies Business Standard/Premium limits only if the seat tier is explicitly detectable; otherwise it refuses to guess.
- Removes the manual GPT-6 cap control from the UI; plan detection determines numeric quota rules.
