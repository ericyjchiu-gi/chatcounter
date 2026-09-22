# Architecture — 2.0.1

## Components

### Native popup

`popup.html` loads the shared calculation modules, `view-client.js`, and the dashboard renderer. It reads snapshots and sends allowlisted commands through extension runtime messages. It never writes the index directly.

### Background engine

`service-worker.js` is the single acquisition coordinator. It:

- selects one account-scoped index explicitly;
- validates UI commands and settings;
- performs authentication and read-only history requests;
- owns retry/cooldown state and toolbar badge updates;
- checkpoints work in bounded slices and schedules continuation with alarms;
- prevents overlap with legacy page-owned worker leases.

`src/background/worker-store.js` supplies serialized schema-3 storage mutations.

### Shared modules

- `core.js` — schema, metadata merge, migration and local preferences
- `api.js` — session identity and read-only transport
- `tasks.js` — source discovery and conversation-page processing
- `policy.js` — coverage, completion, error, pacing and diagnostics policies
- `sync.js` — queue selection and checkpointed worker loop
- `limits.js` — plan-aware estimate windows
- `i18n.js` — English / 中文 strings
- `webext.js` — callback/Promise browser API adapter

### Content layer

- `bridge.js` — isolated-world, read-only ChatGPT transport fallback
- `live.js` — optional MAIN-world passive completed-reply observer
- `view-client.js` — popup/page view protocol
- `ui.js` — shared renderer

## Acquisition lifecycle

```text
24h core → 24h Projects → 7d core → 7d Projects → 30d core → 30d Projects
```

Discovery establishes a conversation denominator. Message detail is then indexed conversation by conversation. Proven coverage and server update times allow unchanged detail to be reused. Recent reconciliation reads headers and fetches only new/changed conversations; Projects rotate across refreshes.

## Concurrency and recovery

A single background engine owns mutations. Worker records and checkpoints are persisted; alarms resume eligible work. HTTP 429 creates a hard Retry-After cooldown and five-minute recovery period. UI commands cannot bypass server cooldowns. Account mismatch stops acquisition instead of merging indexes.

## Data boundary

Only reply metadata enters schema 3. Tokens and raw bodies remain transient. The popup can show cached data while signed out; authentication is required only for acquisition.
