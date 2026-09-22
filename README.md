# ChatCounter 2.0.1

Private, local **saved-history usage estimates** for ChatGPT. ChatCounter reconstructs usage from completed assistant-reply metadata in saved ChatGPT conversations. It is not an official OpenAI quota ledger and does not inspect Codex allowances.

## Current release

**2.0.1** replaces the page-only dashboard with a real Chrome toolbar popup and a single background acquisition engine.

- Native 500px popup available from any browser page
- Cached dashboard opens without requiring a ChatGPT tab
- Background indexing continues after the popup closes
- 24h / 7d / 30d staged indexing, archived chats and Project conversations
- Plan-aware Advanced Chat estimates and a readable toolbar percentage badge
- Incremental reconciliation, shared pacing, Retry-After handling and recovery mode
- English / 中文 and light / dark / system appearance
- Local metadata backup, restore, diagnostics and CSV export

See [CHANGELOG.md](CHANGELOG.md) and [docs/releases/2.0.1.md](docs/releases/2.0.1.md).

## Install or update without losing data

### First installation

1. Extract the release ZIP into a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Pin ChatCounter from Chrome's Extensions menu.

### Upgrade

1. Export a local-index backup from **Settings** as a precaution.
2. Close existing ChatGPT tabs so old page scripts stop running.
3. Replace files inside the **same unpacked extension folder**.
4. Open `chrome://extensions` and click **Reload**.
5. Do not click **Remove** unless you intend to delete extension-local storage.

The public manifest key, extension ID `ffnaboibekmfpegifameabebgpjpdpnn`, `cmm_v17_state_*` keys and schema 3 are intentionally unchanged.

## How it works

```text
Toolbar popup / page fallback
            │
            ▼
Background service worker ──► chrome.storage.local
            │
            ├─ direct read-only ChatGPT history requests
            └─ isolated ChatGPT-tab transport fallback
```

The popup is read-only. One background engine owns history requests and state mutations. Work is checkpointed and resumed through Chrome alarms; closing the popup does not cancel it. Optional live capture is off by default and forwards only completed-reply metadata.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Percentage semantics

The badge shows the **highest applicable estimated utilisation**, not an official remaining balance. For the inherited Pro $200 reference configuration:

```text
max(GPT-6 Pro weekly / 200,
    GPT-5.6 Pro rolling 24h / 170,
    combined Pro rolling 24h / 200)
```

Shared plans use their combined pool. No numeric badge is shown until all baseline ranges and Project discovery are complete. Unsupported or unknown allowances remain neutral. Daily figures are rolling 24-hour counts; weekly figures use the manual reset anchor when configured, otherwise rolling seven days.

## Accuracy and limitations

- Archived conversations are explicitly indexed.
- Chats deleted before ChatCounter observed them cannot be reconstructed.
- Temporary chats and some failed generations may be absent.
- Deleting a chat after capture does not automatically erase its previously observed usage.
- Backend endpoints and plan-limit presets are undocumented and can change.
- Exact provider remaining is always unknown.

## Privacy and permissions

Stored locally: message/conversation IDs, timestamps, model and effort labels, coverage proofs, checkpoints, settings and allowlisted diagnostics.

Not stored: chat text, access tokens, raw response bodies or request headers.

Permissions are limited to `storage`, `alarms`, and `https://chatgpt.com/*`. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Repository layout

```text
manifest.json               Extension manifest and stable identity
service-worker.js           Background controller / scheduler / badge
popup.html, popup.css       Native toolbar popup entry
src/shared/                 Shared model, policy, API and scheduling modules
src/background/             Background-only storage adapter
src/content/                Page transport, optional live capture and dashboard UI
assets/icons/               Manifest icons
docs/                       Architecture, privacy, testing and release history
tests/                      Current 2.0.1 regression harness only
tools/                      Test and deterministic packaging commands
.github/workflows/          CI validation and package artifact
```

Historical tests and generated reports were removed from the active tree; Git history remains the source of record. Historical release notes live under [docs/releases/archive](docs/releases/archive/README.md).

## Development

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python tools/test.py
python tools/package.py
```

The current suite executes production service-worker code against simulated extension APIs/backend responses and renders the actual popup UI in Chromium at 500px. Native extension installation, real authenticated ChatGPT endpoints and Orion/iPad remain manual validation boundaries. See [docs/TESTING.md](docs/TESTING.md).
