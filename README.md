# ChatCounter 1.7.1 — Universal

One source tree and one flat ZIP for Chrome and Orion. This build targets the common capabilities used successfully by the earlier Orion build; it is not a claim that every Chrome/Orion version has identical extension support.

## Install or update

**Orion:** install the flat ZIP using file-based extension installation. `manifest.json` is at the ZIP root.

**Chrome:** extract the ZIP to a fixed directory, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. For later updates replace files in that same directory, then choose **Reload**.

Prefer an in-place update and keep only one version enabled. Refresh existing ChatGPT tabs after updating. Removing an extension or changing its identity may remove/separate its local cache. Do not clear ChatGPT website data or paste an auth token anywhere.

Open **Meter**. A new installation shows **Build history baseline**. An imported partial v1.6 cache shows **Resume**; saved records are reused, but missing coverage proofs must be verified.

## Sync & History

All history, sync, heartbeat, queue, error and acquisition settings live in one expandable region. v1.7.1 adds an explicit **Collapse / Expand** button; when collapsed the three usage cards sit immediately below the compact Sync & History row.

- Expanded for first use, a partial baseline, pause, or a new error.
- Automatically collapsed after the 24h / 7d / 30d historical stages finish with no outstanding issue.
- A deliberate expand/collapse is retained for the current panel session. A new error reopens it.
- Default analytical range: **24 HOURS**. The chart groups GPT-5.6 / GPT-5.6 Pro / GPT-6 Pro. Raw model and effort remain in the table.
- Opening the panel does not start a history scan by default. A lightweight account/session check still happens. Separately, an already-authorized baseline or due automatic reconciliation may run in an active tab.

Worker heartbeat and local listener heartbeat are different from server reconciliation. Neither heartbeat is an HTTP request to ChatGPT. When no scan is running the worker is correctly shown as **Idle**, rather than inventing a continuously running scanner.

## Acquisition engine

The initial build is staged: **24 hours → 7 days → 30 days**. Targets share a fixed snapshot anchor. Core history uses regular + archived conversations. Project discovery is optional: after repeated 5xx/network failures it becomes **degraded** and no longer blocks core baseline progression. The UI distinguishes full completion, core completion with Project warnings, and core gaps.

Between 24h→7d and 7d→30d the engine inserts a conservative 2–5 minute soft pause. Request spacing adapts to recent 5xx/latency. **Start now** may override a soft pause and **Run faster this session** increases request pace for the current tab session only. HTTP 429 / Retry-After, auth, schema and storage protection remain hard stops and cannot be overridden. Progress is durable after every successful discovery page and message page. Jobs retain pagination cursors, known conversation update timestamps, and coverage intervals. Replies are deduplicated by message ID. Partial results are merged rather than replacing a successful cache with an incomplete refresh.

A conversation is skipped only if **both** its update timestamp is unchanged **and** its verified coverage contains the requested range. Widening 24h to 7d/30d may need older pages even when no new chat was posted. Where available an older-page continuation is reused. All metadata from an already downloaded page is reused within the retention window.

Recent-device reconciliation takes priority over older backfill at a page boundary. Its watermark advances to the start of a successful pass, not the end, so changes during the pass can be rediscovered. Failed passes do not advance it. Explicit **Rebuild history** rechecks coverage but retains saved events.

## Multiple tabs and recovery

- Browser-native Web Locks provide account-scoped scanner exclusion and separate serialized store transactions. There is no background-worker/tab-ID lock in the correctness path.
- Baseline state, cursors, errors, cooldown and pause are shared through extension local storage.
- An active worker publishes an advisory heartbeat approximately every 10 seconds, with a 45-second stale threshold.
- Hiding/navigating the worker page aborts its next request and releases the lock after cleanup. Destruction of the browser context releases its native locks.
- Another eligible active tab can resume a started baseline from saved work. A stale heartbeat **never** authorizes stealing a native lock held by a living page.
- If iPadOS suspends every page, nothing executes. Resume requires an active authenticated page. Scheduling is best effort, not a guaranteed background service.

## Error handling

HTTP 429 persists an account-wide `Retry-After` cooldown and stops additional requests. The rejected task is an actual error; tasks never requested remain **pending/deferred**. Retry controls cannot bypass this cooldown. 5xx/network retry uses 10s → 30s → 2m → 10m; optional Project sources become degraded after repeated failure and retry later without blocking core history. Repeated 404/403 remain explicit gaps. Schema/cursor/safety-cap errors stop or flag incomplete work rather than claiming completion. Auth/account changes and storage failures are explicit errors.

The error ledger stores stage, conversation/source identifier, code, HTTP status, attempts, last attempt, next eligible retry and degraded/optional status. The main Sync & History region shows the latest error type directly. Diagnostics adds **Copy diagnostics**, **Export diagnostics.json**, and a 200-entry metadata-only sync ring log. Raw response bodies, chat text, tokens and headers are not logged or exported.

## Storage and privacy

Uses callback- or Promise-compatible `storage.local`, verified with a disposable write/read probe before scanning. No service worker, `tabs`, `alarms`, `storage.session`, remote libraries, or telemetry is required. The only extension permission is `storage`, scoped for injection to `https://chatgpt.com/*`.

Tokens remain inside the API module's memory and are returned only to ChatGPT. Cached data is metadata: message IDs, timestamps, model/effort, conversation IDs, coverage, queue and diagnostic state. Account and user identifiers are hashed into the new storage scope. Legacy v1.6 data is imported without deleting the old copy; its coverage is deliberately treated as unverified.

Retention is 90 days; a storage-quota error triggers a 45-day retry while keeping the latest 30 days. If storage is still full, the write fails visibly. No valid recent records are silently dropped to make a scan appear successful.

## Quota interpretation

This is a ledger of observed **saved replies**, not the official usage ledger. Deleted/temporary chats, incomplete generations, missing metadata, branches and private-endpoint differences may affect counts. **Even an indexed history is not proof of exact remaining quota.** The UI therefore never says “guaranteed remaining”.

Plan labels and numeric references preserve the existing v1.6 presets. They are labeled references, not freshly verified or server-reported entitlements. Generic Business/Enterprise/Edu/unknown plans do not receive a guessed personal Pro cap. The manual reset remains an assumption, not a copied Codex reset.

## Tests and package

`python tests/browser_regression.py` runs offline Chromium integration checks (requires Python Playwright and Chromium). DOM interactions run in a real browser; ChatGPT HTTP, extension storage and Web Locks are simulated. The test fixture uses an accelerated clock for request pacing. `tests/RESULTS.json` records the executed checks. These are **not Orion/iPad device tests**.

`python tools/package.py` validates the manifest and JavaScript, then builds a reproducible flat ZIP in `dist/` plus per-file SHA-256 hashes. The GitHub workflow packages committed source directly; it does not assemble source from encoded chunks.

## Platform references

- Chrome storage API: https://developer.chrome.com/docs/extensions/reference/api/storage
- Web Locks: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- Orion iOS/iPadOS extension status: https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html
