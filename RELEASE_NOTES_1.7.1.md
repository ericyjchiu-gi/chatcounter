# v1.7.1 — Stability, throttling and diagnostics

## Sync & History UI

- Adds an explicit **Collapse / Expand** button to the Sync & History panel.
- The three model usage cards are placed immediately after the compact Sync & History row, so collapsing the panel exposes the primary usage view without the large sync body.
- Queue/button labels are state-aware: build, retry, soft-wait override, active backfill, rate-limit hard stop, reconcile.
- Pause is enabled only while a scanner is active.
- Error type, source, HTTP status, attempt count and retry/degraded state are surfaced directly in Sync & History.

## Project-source degradation

- Regular + archived history are the **core** baseline.
- Project discovery / Project conversation sources are optional coverage.
- Repeated Project 5xx/network failures become **degraded** after five attempts and no longer block the core 24h/7d/30d stages.
- A stage can be `complete_with_warnings`: core indexed, Projects pending/degraded. Project retries continue at low priority.
- Optional Project schema failures degrade that source instead of globally blocking otherwise valid core history.

## Adaptive throttle and manual override

- 24h→7d and 7d→30d transitions wait a randomized 2–5 minutes by default.
- Auto request spacing reacts to recent 5xx/network failures and latency.
- **Start next stage now** may override only these soft waits.
- **Run faster this session** is a tab-session-only override and returns to Auto on reload/new tab.
- HTTP 429 / Retry-After remains a hard cooldown and cannot be bypassed.
- Large historical bursts pause after a conservative request budget unless Fast is active.

## Retry and observability

- Manual Retry immediately requeues retryable/degraded tasks unless a hard 429 cooldown is active.
- A fast repeated 500 now visibly increments attempts/log state instead of appearing as a no-op.
- 5xx/network retry schedule: 10s → 30s → 2m → 10m, then optional Project sources degrade and retry later.
- Adds a 200-entry metadata-only sync log, **Copy diagnostics**, and **Export diagnostics.json**.
- Diagnostics never export chat text, auth tokens, headers or response bodies.

## Compatibility

- Still one universal flat package for Orion and Chrome.
- Keeps the v1.7 storage key/schema and upgrades v1.7.0 state in place. Existing Project errors with five or more attempts are normalized to degraded warnings on read, preserving cached data.
