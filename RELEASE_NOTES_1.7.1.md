# v1.7.1 — Compact sync, source-aware recovery and pacing

## Sync & History

An explicit **Collapse / Expand** button now controls the sync area. Collapsing keeps
its heading, status and **24h / 7d / 30d coverage cards visible**, while hiding worker,
heartbeat, queue, controls, settings and diagnostics. Model usage cards and charts
remain below it. Manual collapse is respected for the current panel session, even
when a new error appears; the summary and coverage cards still report missing data.
First use expands by default. Fully indexed, healthy history collapses automatically.

Main controls report their real effect: build/resume, retry once, scheduled rest,
active scanner, hard server cooldown, or needs attention. Commands have immediate
visible feedback. Pause is enabled only while a scanner is active. Core and Project
coverage are distinguished, rather than presenting 19 checked chats as proof of a
complete account history.

## Projects HTTP 500 recovery

Regular and archived history form the **core** queue. Projects are a separate source
of coverage, not dispensable data: their failure never produces a false claim that
the full account history is complete. Core 24h/7d/30d work may proceed while Projects
are pending. All Project warnings remain visible and exact quota remaining stays unknown.

5xx/network retries use 10 seconds, 30 seconds, 2 minutes and 10 minutes. After five
consecutive Project failures, a shared source circuit waits 30 minutes before another
automatic attempt. Multiple stages do not each probe the same failed source during
that circuit's cooldown. Existing seven-attempt v1.7.0 Project errors migrate to this
state without discarding replies or continually moving the retry deadline.

**Retry errors once** makes at most one manual attempt per failing target in that
command. Rapid repeats are limited to one per target per 10 seconds. A new failure
increments the visible attempts/log and restores backoff. It does not erase a hard
schema, account, storage or auth protection. Recheck sign-in requires a successful
session refresh. Server HTTP 429 cooldown cannot be bypassed by Retry, Resume,
Start now, Rebuild, or Fast.

## Adaptive pacing and user control

Core stages proceed 24h -> 7d -> 30d. A randomized **2–5 minute client-side rest**
separates stages. Older stages are paced more slowly. These are application settings,
not published OpenAI rate limits, and cannot guarantee avoidance of throttling.

| Mode | 24h minimum gap | 7d gap | 30d gap | Backfill page budget before rest |
|---|---:|---:|---:|---:|
| Auto (default) | 1.5s | 2.5s | 4s | 60 requests |
| Conservative | 3s | 5s | 8s | 40 requests |
| Fast | 1s | 1s | 1s | 100 requests |

Recent response health may increase these gaps, including in Fast mode. Request
history, budget and cooldown are shared across tabs; mode selection is local to the
current page session and returns to Auto on reload/new tab.

**Start next stage now** only skips a client-side rest. Selecting Fast does not skip
a scheduled rest. Recent-device reconciliation has priority over older history but
still respects shared server cooldowns. Timers require an eligible active page;
background execution during iPad/browser suspension is not promised.

## Observability

Source, HTTP status, error code, attempts and next retry are visible in Sync & History.
A 200-event metadata-only ring buffer records HTTP outcomes, errors, checkpoints,
stage transitions and control/scanner activity. **Copy diagnostics** and **Export
diagnostics.json** include this log and state summaries, not chat text, tokens,
headers or response bodies. Never-requested tasks remain pending/deferred, not failed.

## Packaging and upgrade

One flat-root Universal ZIP; same account-scoped v1.7 storage keys/schema. Update in
place to retain local data. Do not uninstall or clear website data just to upgrade.
Only enable one installed version, and refresh ChatGPT pages after updating.

## Validation

19 existing offline browser regressions plus 13 v1.7.1 scenarios pass (32 total).
They use real Chromium DOM with mocked ChatGPT HTTP/storage and simulated locks.
The new suite reproduces Project500, tests actual Retry button behaviour, hard
cooldown overrides, stage rests, diagnostics download, collapse and migration.
This is not an iPad/Orion true-device certification. See tests/RESULTS.json and
 tests/STABILITY_171_RESULTS.json for individual checks.
