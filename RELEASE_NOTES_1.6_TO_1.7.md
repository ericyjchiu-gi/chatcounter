# v1.6 → v1.7.0 — Universal staged history

## User-facing changes

Replaces the contradictory initial-build box and scattered sync messages with one **Sync & History** region. It begins expanded, shows real shared progress across tabs, and collapses after normal historical indexing completes. New errors expand it; manual expansion is respected for the current panel session.

The region includes 24h / 7d / 30d coverage, cache size/counts, pending versus actual error/deferred tasks, current worker, worker heartbeat, local listener heartbeat, checkpoint, last/next reconciliation, pause/resume/retry/rebuild, settings and exportable diagnostics. The analytical view still opens at 24 hours.

## Sync and persistence fixes

- One universal, flat-root extension package; no separate Orion/Chrome source branches.
- One account-scoped native scanner lock; independent serialized store writes prevent simultaneous tabs losing updates.
- Shared baseline state distinguishes never started, migrated partial, running, paused, cooldown, gaps and indexed history.
- Stage 24 hours first, then 7 days and 30 days. Save every discovery/message page so an interrupted page can be retried idempotently.
- A new tab observes existing progress. A destroyed worker can be replaced after native lock release. A 45-second advisory expiry helps identify stale UI state but never steals a lock from a living page.
- Widening a time range no longer mistakes “known message ID” or “unchanged conversation” for proof that earlier history was indexed.
- Reuse verified coverage and continuation cursors; deduplicate metadata already obtained.
- Recent-device reconciliation has priority over old backfill at a page boundary. Failed work retains the previous reconciliation watermark.
- Remove background service-worker, tab-ID and alarms dependencies from this universal package. Scheduling runs while an eligible ChatGPT page is active; it is not guaranteed while the browser is suspended.

## Error and quota corrections

- A 429 is one rejected task; the rest of the queue is deferred, not falsely reported as hundreds of fetch failures.
- Persist cooldown, attempts and retry times across tabs/reloads. Retry never ignores `Retry-After`.
- Explicit 5xx/network, auth, permission, unavailable conversation, schema/cursor and storage categories.
- Storage readback probe, strict invalid-response handling, and visible failures instead of silent empty caches.
- Exact remaining quota remains unknown. Indexing available replies does not prove that every quota-bearing request is represented. Existing numeric plan references are clearly labeled presets, not server balances.

## Upgrade behaviour

Update in place to preserve extension storage. v1.6 metadata is imported without discarding it; a partial import displays **Resume**, not “no initial history”. Old data lacks coverage proofs, so some verification requests are necessary. No automatic initial scan is started for a brand-new account. Do not uninstall or clear site data merely to hide an incomplete-state message.

## Validation and limits

19 offline Chromium checks passed at packaging time. They cover first use, staged widening, collapse/reopen, multi-tab ownership/handover, dedupe, cooldown enforcement, retry, pause, schema failures, persistence failure, callback/Promise APIs, migration and account isolation. Browser DOM is real; ChatGPT, storage and lock behaviours are simulated fixtures. Orion/iPad true-device validation remains pending.

Live capture remains best effort for completed reply objects visible in fetch/SSE responses. Unsupported delta/WebSocket formats fall back to saved-history reconciliation; no unsupported format is claimed as comprehensively captured.

Repository release source is modular. Failed v1.6.4 `.build` chunks and the assembly workflow are removed from the active tree. Packaging reads committed source directly.
