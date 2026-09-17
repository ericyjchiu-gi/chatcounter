# ChatCounter 1.7.1 — Universal

A Chrome/Orion browser extension that reconstructs model usage from saved ChatGPT
reply metadata. It is **not an official quota ledger**. One source tree and one flat
ZIP target their common browser capabilities; platform-specific behaviour still
requires real-device testing.

## Install or update

For Chrome, extract the package into the same existing unpacked-extension folder,
then use Reload in `chrome://extensions` and refresh your ChatGPT tabs. For Orion,
install/update from the flat ZIP using Extensions. Update in place where supported;
uninstalling may erase extension storage. Only one version should be enabled.

A brand-new account does not trigger a history scan. Open Meter and choose Build
history baseline. Existing partial v1.7 metadata is retained; v1.6 metadata migrates
as saved data awaiting coverage verification. Opening the dashboard may refresh
account/session metadata, but does not itself enumerate history unless that setting
is explicitly enabled.

## Sync & History

Everything related to acquisition lives here. Collapse keeps the heading, health
summary and three **24 HOURS / 7 DAYS / 30 DAYS coverage cards**, not the entire
control panel. Expand restores worker heartbeat, local listener heartbeat, cache,
queue, errors, pacing, controls and diagnostics. Manual collapse is respected for
this panel session. Healthy fully indexed history auto-collapses.

The analytical range remains **24 hours by default**, with 7- and 30-day toggles.
Model series are GPT-5.6, GPT-5.6 Pro and GPT-6 Pro; raw model/effort remains in the
metadata table. No plan or quota balances are inferred from an empty cache.

## Acquisition and coverage

Core regular/archived history is built 24h -> 7d -> 30d. Each stage's target has a
fixed snapshot anchor. Projects have independent health; source failures do not
stop core stages, but Project coverage stays explicitly incomplete. A core-complete
stage is not the same as fully indexed history.

A native account-scoped Web Lock excludes simultaneous scanners, with a separate
store lock serializing writes. State, errors, jobs, pagination cursors and checkpoint
are durable across panels/tabs. A page that is hidden pauses its active request; a
closed page releases its native lock so an eligible active page can resume. A stale
advisory heartbeat never steals a lock from a living page.

Each successful discovery/message page is saved. Already indexed conversation
history is reused only when server update time and proven coverage permit it.
Widening 24h to 7d/30d may need older pages even when a conversation is unchanged.
Reconciliation prioritizes recent updates; live capture is best effort for completed
objects visible in fetch/SSE responses. Unsupported streaming forms fall back to
saved-history reconciliation. No chat message is sent by this extension.

## Pacing and recovery

Default Auto pace uses at least 1.5s/request for 24h, 2.5s for 7d and 4s for 30d.
Recent latency/failures can make it slower. Stages rest 2–5 minutes; a request budget
also causes rests. Conservative and Fast modes are per-page-session overrides.
Start now skips only a soft rest, not a server cooldown. These are client policies,
not official API thresholds or a guarantee against 429.

5xx/network errors back off 10s -> 30s -> 2m -> 10m. Five repeated Project failures
open a shared 30-minute source circuit. Retry errors once permits one safe manual
attempt per failing target and reports the result. Rapid repeats are gated. HTTP
429 / Retry-After, account mismatch, schema and storage errors cannot be overridden.
Core schema errors stop the scanner; an optional schema failure stops that source.
Repeated 403/404 remain explicit unavailable gaps, not empty-history success.

## Diagnostics and privacy

The main sync area displays source, error code, HTTP status and retry time. Diagnostics
can be copied or exported as JSON and include the last 200 allowlisted sync events.
No chat text, token, raw response body or auth header is logged or exported. The
persistent cache contains message IDs, conversation IDs, timestamps, model/effort,
coverage, job/control state and source health. History metadata is retained up to
90 days (45-day fallback on storage quota errors). Old replies alone cannot prove
that deleted/temporary/failed quota-bearing requests have been captured.

Authentication uses the current ChatGPT web session; the access token stays in page
memory and is sent only to permitted same-origin history endpoints. Exact quota
remaining remains UNKNOWN. Numeric plan references are inherited v1.6 presets,
not current server-reported entitlements, and should not be treated as authoritative.

## Source and tests

- core.js: metadata store, migration, identity-independent primitives
- api.js: read-only session/history transport
- tasks.js: discovery/detail parsing and coverage checkpoints
- policy.js: completion, source isolation, retry, throttle and diagnostics policies
- sync.js: native-lock scheduler and explicit control outcomes
- live.js: best-effort passive metadata observation
- ui.js: dashboard, compact sync panel and exports
- bridge.js: callback/Promise-compatible extension storage adapter

Run `python tests/browser_regression.py` and `python tests/stability_171.py` with
Playwright and Chromium available. Run `python tools/package.py` for a deterministic
flat ZIP. Test results are fixture-based, not a real-account or Orion/iPad certification.

See RELEASE_NOTES_1.7.1.md for the full change list.
