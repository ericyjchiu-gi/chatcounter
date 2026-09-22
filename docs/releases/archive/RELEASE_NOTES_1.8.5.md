# v1.8.5 — Usage intelligence, compact sync, settings, portability and shared pacing

## Usage intelligence redesign

- Replaces the long plan-estimate paragraph with **Advanced Chat Usage & Limits**.
- Displays three plan-aware cards in one row.
- Supports Pro $200, Pro $100, Business Standard and Business Premium reference structures.
- Deliberately makes no numeric Advanced Chat allowance inference for Plus or unknown plans.
- Keeps exact provider remaining explicitly unknown.
- Combines the 24h / 7d / 30d segmented range control, four selected-range KPIs, and usage trend in one block.
- Selected-range KPIs are Normal chats, GPT‑5.6 Pro, GPT‑6 Pro and Total Pro.

## Sync & History

- Healthy collapsed state is now one compact row: title, status pill and Expand control.
- Coverage cards, queue, worker, controls and diagnostics are shown only while expanded.
- Initialization progress remains conversation-based and non-linear.

## Settings

- Restores a dedicated Settings screen.
- Manual weekly reset weekday, time and timezone are used only for local estimates.
- Language follows the browser by default and can be overridden to English or 中文.
- Theme follows the system by default and can be overridden to light or dark.
- Adds local index export/import. Backups contain metadata and coverage state, never chat text, raw bodies, headers or authentication tokens.

## Stable identity and upgrade resilience

- Adds a fixed public manifest key so future unpacked installs have a stable extension ID.
- Existing `storage.local` is preserved when the browser updates the same extension identity.
- The first transition from an older keyless installation may still create a new identity depending on installation method; export/import provides a recovery path.

## Request governor and Project refresh

- Recent reconciliation now consumes the same shared 25/40/55 request budget as baseline work.
- Stage completion no longer resets the shared burst counter.
- Existing Retry-After and 45-second recovery pacing remain enforced.
- Recent synchronization rotates four Projects per cycle. With 16 Projects, a typical no-change refresh falls from about 21 backend requests to about 9, while successive cycles cover all Projects.

## Preserved capabilities

Landing-page consent, staged 24h → 7d → 30d indexing, archived history, corrected Project discovery, incremental conversation fetching, native cross-tab locking, durable resume, optional live capture, plan detection, structured errors, diagnostics/CSV export, rebuild, pause/resume, account isolation, and v1.6/v1.7/v1.8 state migration remain available.

## Validation

- 19 base browser regressions passed.
- 15 source-order and recovery tests passed.
- 7 onboarding/progress/rate-governor tests passed.
- 8 v1.8.5 settings/limits/portability/shared-budget tests passed.
- Total: 49 offline Chromium checks.
- JavaScript syntax, manifest references, stable public key, icon dimensions, package contents, and deterministic ZIP output are validated during packaging.
