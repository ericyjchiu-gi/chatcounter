# Release notes — v1.5 → v1.6

## Summary

v1.6 is an architectural change rather than a UI-only release. v1.5 still treated server conversation history as the primary source and used caching to reduce repeat work. v1.6 changes the model to:

> **live event capture first + lightweight server reconciliation second**

The goal is to reduce unnecessary ChatGPT history requests, avoid multi-tab duplicate scans, and make opening the dashboard a local read rather than an implicit sync action.

## 1. Multi-tab coordination moved to a background service worker

### v1.5

The single-flight guard lived in the ChatGPT page's JavaScript context. It prevented duplicate work when the Meter panel was closed/reopened in the same tab, but a second ChatGPT tab had a separate guard and could start another reconciliation.

### v1.6

A Manifest V3 background service worker now owns a Chrome-profile-wide reconciliation lease.

- Only one ChatGPT tab can reconcile at a time.
- Other tabs remain live sensors but do not duplicate history requests.
- Closing/reloading the owner tab releases the lease.
- Reconciliation progress already written to `chrome.storage.local` is retained.

This directly addresses the v1.5 multi-tab/session-reload class of bugs.

## 2. Opening the Meter no longer implies a server scan

### v1.5

An empty/stale cache could automatically trigger synchronization when the Meter opened.

### v1.6

Opening the Meter renders local data immediately and does not enumerate conversation history.

A lightweight account/session refresh may still run to verify account scope and plan type, but it does not scan chats.

New settings:

- **Capture live messages** — default **On**
- **Background reconciliation** — default **On**
- **Reconcile when Meter opens** — default **Off**

The first historical backfill is now an explicit action: **Build initial cache**.

## 3. Live event capture

v1.6 observes ChatGPT Web's existing completed response stream and records only message metadata:

- `message_id`
- timestamp
- raw model slug
- reasoning/thinking effort

No extra history request is required for a locally observed completion.

Events are stored in a separate local live ledger and de-duplicated by `message_id`. This avoids write races between live capture and server reconciliation.

Live capture is opportunistic rather than authoritative: server reconciliation remains the fallback for other devices/apps and for browser events the observer cannot see.

## 4. Reconciliation is now incremental at two levels

### Conversation-level

v1.6 lists conversation headers newest-first and uses the last successful reconciliation timestamp as a cutoff, with a small overlap for race tolerance.

Once a list page is older than the cutoff, discovery stops.

Result: a normal refresh should usually inspect only the newest list page(s), not re-enumerate ~30 days of history.

### Message-level

For a changed conversation, v1.6 fetches newest messages first. As soon as it encounters a previously cached `message_id`, pagination stops.

Result: adding two new messages to a long-lived thread should normally require only the newest page, not a re-read of the entire thread.

## 5. Failed fetches no longer move the reconciliation watermark past missing data

v1.5 could finish a partial run and still advance `lastSync`, which risked making a failed changed conversation harder to rediscover.

v1.6 advances the incremental watermark only after a clean reconciliation. If one or more conversation fetches fail after retries, the previous watermark is retained so the failed updates remain eligible next time.

Cached data is never replaced by a partial failure result.

## 6. Project discovery is cached

The Projects list is no longer rediscovered on every incremental reconciliation.

- Project IDs are cached locally.
- The Project list is refreshed on a full rebuild or roughly once per day.
- Individual Project conversation lists still use the same incremental time cutoff.

## 7. Initial build vs reconciliation are now separate operations

- **Build initial cache / Rebuild last 32 days**: heavier historical operation.
- **Reconcile now**: lightweight incremental cross-device update.
- **Live capture**: zero-extra-history-request browser updates.

This makes the cost of each action explicit.

## 8. Existing cache migration

v1.6 intentionally keeps the established `cmm_v14_*` history/settings keys so existing v1.4/v1.5 data survives an unpacked-extension upgrade.

A v1.5 cache is migrated in memory to the v1.6 schema. A prior successful v1.5 sync is treated as an existing initial history build.

The new live-event ledger uses separate `cmm_v16_live_*` keys.

## 9. Quota and plan logic

The v1.5 account-plan detection and plan-aware quota safety view remain in v1.6.

The dashboard continues to show only the high-level model families:

- GPT-5.6
- GPT-5.6 Pro
- GPT-6 Pro

Raw model slug and reasoning effort remain available in the detail table.

## Known limitations

- Live capture currently observes the ChatGPT Web response transport; OpenAI can change private web implementation details at any time.
- Cross-device messages still require reconciliation because a browser extension cannot observe activity that happens on another device directly.
- The extension reconstructs usage from message events; it is not an official OpenAI quota ledger.
- Exact Chat weekly reset anchors may remain unknown until OpenAI exposes them, so rolling-window quota views remain conservative bounds where applicable.
