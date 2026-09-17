# ChatGPT Message Meter

Current development version: **v1.6.0**

A Chrome/Chromium extension that reconstructs ChatGPT usage from account conversation history, captures new browser messages as events, and keeps a persistent local metadata cache for quota-safety analytics.

## What v1.6 changes

v1.6 moves the extension from a history-scanner-first design to an **event collector + reconciliation** design:

- Live ChatGPT Web completions are captured opportunistically with **zero extra history requests**.
- All ChatGPT tabs in the Chrome profile share one **background sync coordinator / lock**.
- Reconciliation is incremental:
  - list conversations newest-first;
  - stop once the list is older than the last successful reconciliation;
  - fetch only new/changed conversations;
  - within a changed conversation, read newest messages first and stop once a cached message ID is encountered.
- Opening the Meter does **not** automatically build history.
- First history build is explicit through **Build initial cache**.
- Background reconciliation is optional and defaults to on; it runs approximately every 30 minutes while a ChatGPT tab is open, but only after an initial history build exists.
- **Reconcile when Meter opens** is a separate setting and defaults to off.

See [`RELEASE_NOTES_1.5_TO_1.6.md`](RELEASE_NOTES_1.5_TO_1.6.md) for the full migration notes.

## Current features

- Persistent `chrome.storage.local` metadata cache
- Separate live-event ledger, de-duplicated by `message_id`
- Multi-tab coordinator in an MV3 background service worker
- Cross-tab single-flight reconciliation
- Live browser message capture
- Incremental cross-device reconciliation
- Conservative pacing and retry/backoff for `429` / `5xx`
- 24 hour / 7 day / 30 day trend dashboard
- Dashboard model families:
  - GPT-5.6
  - GPT-5.6 Pro
  - GPT-6 Pro
- Raw model slug + reasoning effort detail table
- Account-plan detection (`pro`, `prolite`, `plus`, Business, Enterprise, Edu, etc.)
- Plan-aware quota safety logic where public caps are sufficiently reliable
- Optional manual Chat reset anchor, explicitly treated as an assumption unless ChatGPT exposes the real reset
- Account-scoped cache
- Up to 90 days of message metadata retained locally, with a 45-day storage-pressure fallback

## Sync model

### Opening the dashboard

Opening the Meter reads local storage only. It does not enumerate ChatGPT conversations.

A lightweight `/api/auth/session` refresh may run to confirm the current ChatGPT account and plan, but this is not a history scan.

### Live capture

When ChatGPT Web completes an assistant turn in this browser, the extension observes the existing ChatGPT response stream and records only:

- message ID
- timestamp
- model slug
- reasoning/thinking effort

No chat text is stored.

Live capture is opportunistic. If OpenAI changes the response transport or a completion is not observable, normal reconciliation remains the fallback.

### Reconciliation

Reconciliation exists primarily to pick up activity from other devices/apps and any browser events missed by live capture.

After the first build, a normal reconciliation starts from the last successful reconciliation time (with a small overlap), scans conversation lists newest-first, and stops when it reaches older entries. Only changed/new conversations are fetched.

For changed conversations, message retrieval starts from the newest page and stops once a previously cached message ID is encountered.

### Multiple ChatGPT tabs

Every ChatGPT tab can act as a live sensor, but only one tab can own the Chrome-profile reconciliation lock at a time. The lock is coordinated by `background.js`.

Closing the Meter panel does not cancel a reconciliation already running in that tab. Reloading/closing the owning browser tab releases the shared lock; already-persisted cache progress remains available.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder.
6. Refresh `https://chatgpt.com`.
7. Click the **Meter** pill at the bottom-right.

When upgrading an existing unpacked install, replace the files in the same extension folder and click **Reload** in `chrome://extensions`. Existing v1.4/v1.5 history cache keys are intentionally retained and migrated in place.

## Default sync settings

- **Capture live messages:** On
- **Background reconciliation:** On
- **Reconcile when Meter opens:** Off
- **Initial history build:** Manual

The background reconciler does nothing until an initial history build has completed.

## Security model

The extension reads ChatGPT's web `accessToken` from `/api/auth/session` into page memory because current private history endpoints require bearer authentication.

The token is never displayed, exported, logged, or written to extension storage. It is sent only back to `chatgpt.com` for authenticated requests.

Persistent storage contains metadata only. Chat content is not cached.

## Important limitation

This is a reconstruction from server-side conversation history plus opportunistic live events, **not OpenAI's official quota ledger**.

Temporary/deleted chats, failed generations, server-side quota events absent from conversation history, or changes to ChatGPT's private web APIs can create discrepancies.

Rolling-window “guaranteed remaining” figures are conservative only to the extent that the reconstructed message history is complete and the applicable quota window assumptions are correct.
