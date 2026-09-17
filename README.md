# ChatGPT Message Meter

Current development version: **v1.4.1**

A Chrome/Chromium extension that reconstructs ChatGPT usage from account conversation history and keeps a persistent local metadata cache for incremental analytics.

## Current features

- Persistent `chrome.storage.local` cache
- Incremental sync based on conversation `update_time`
- Single-flight sync so reopening the panel does not start duplicate scans
- 15-minute automatic refresh cooldown after a completed sync
- Conservative pacing and retry/backoff for `429` / `5xx`
- 24 hour / 7 day / 30 day trend dashboard
- Dashboard model families:
  - GPT-5.6
  - GPT-5.6 Pro
  - GPT-6 Pro
- Raw model slug + reasoning effort detail table
- Rolling 7-day GPT-6 Pro safety view
- Optional manual reset anchor, explicitly treated as an assumption unless ChatGPT exposes the real reset
- Account-scoped cache
- Up to 90 days of message metadata retained locally, with a 45-day quota fallback

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

No chat text is cached.

## Important limitation

This is a reconstruction from server-side conversation history, **not OpenAI's official quota ledger**. Temporary/deleted chats, failed generations, or quota-bearing events missing from conversation history can create discrepancies.

The rolling 7-day GPT-6 Pro count is therefore useful as a conservative bound only when history retrieval is complete.

## v1.4.1

- 24 HOURS is the default every time the panel opens.
- Closing/reopening the Meter no longer starts a duplicate scan.
- An in-progress sync continues in the background; a reopened panel attaches to the same job.
- Automatic sync is suppressed for 15 minutes after a completed sync.
- The current chat no longer receives a fake `Date.now()` update timestamp.
- Server conversation `update_time` is the incremental-fetch trigger.
- Cache size display reflects the actual cached payload.
