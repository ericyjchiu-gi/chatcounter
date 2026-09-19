# ChatCounter 1.9.0 — Universal

A Chrome/Orion extension for exploring **locally recorded ChatGPT usage**. It indexes saved assistant-reply metadata, not OpenAI's private quota ledger. This repository and its flat-root installation ZIP contain the same runtime source.

## What's changed since 1.8.5

**One layout change:** Raw Model Metadata is now its own collapsible block below Advanced Chat Usage & Limits. It starts closed and has an explicit Expand/Collapse button. The table, selected-range filtering and metadata CSV export are unchanged.

Sync & History remains first. Advanced Chat Usage & Limits retains its three quota bars, segmented range control, four usage cards, chart, colours and interactions. Settings, language/theme controls, indexing and quota calculations have not been redesigned.

The public manifest key, storage keys and schema are the **same as the supplied 1.8.5 ZIP**. Returning users with readable local data open the dashboard directly. Neither a welcome screen nor another indexing step is added.

## Updating without losing your index

### Chrome Developer Mode — recommended

1. Before changing installations, use **Settings → Export local index** as a backup.
2. **Do not click Remove.** Close ChatGPT tabs to avoid mixing old and new content scripts while updating.
3. Extract the new ZIP and replace the files **inside the existing extension folder**. Keep the same folder path. `manifest.json` must be directly inside it, not in a nested version folder.
4. Open `chrome://extensions` and click **Reload** on ChatGPT Message Meter.
5. Reopen ChatGPT and click **Meter**. Existing complete or partial indexes bypass Start Indexing; only normal configured reconciliation may run.

For the first installation, enable Developer mode, choose **Load unpacked**, then select that folder.

### Fixed extension ID

The shipped public key produces this Chrome development ID:

```text
ffnaboibekmfpegifameabebgpjpdpnn
```

The key is retained, not regenerated per release. It keeps the development ID consistent across folders. It does **not** perform automatic ZIP installation, reach into another browser/profile, or keep data after uninstalling. Same-folder replacement plus Reload is still the recommended update path.

An older keyless build may have a different ID. Export from the old installation before changing identities, then import using the same ChatGPT account. Never enable two different-ID copies at once.

Chrome documentation: [manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key) and [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage). Chrome removes extension-local storage on uninstall. If it was removed without a backup, re-indexing is necessary; a stable key cannot recover deleted storage.

### Orion

Use the same ZIP, with `manifest.json` at its root. Prefer Orion's in-place update mechanism where available. Export the index before replacing an installation. Orion/iPad update behaviour requires device testing; a matching Chrome ID is not proof of Orion storage retention.

## First run and returning users

A new account with no locally stored index sees the landing page. Clicking **Start Indexing** opens the full dashboard and starts history acquisition. Opening the landing page can check the signed-in session, but does not enumerate history.

Complete, partial, paused, imported or migrated indexes open the dashboard instead. A paused index remains paused. A stale index is eligible for the normal configured refresh, not a forced rebuild. An unreadable store must not be interpreted as a recoverable deleted database.

## Interface

1. **Sync & History** — always at the top; one status-pill row when collapsed. Expand for coverage, progress, queue, worker heartbeat, pacing, errors and diagnostics.
2. **Advanced Chat Usage & Limits** — reference quota bars stay on their configured windows. The 24h/7d/30d segmented control changes the usage cards and chart, not those quota windows.
3. **Raw Model Metadata** — separate block, closed by default. Expand to inspect the existing model/effort table and export metadata CSV.
4. **Settings** — opened from the header; weekly reset assumptions/timezone, browser-default or manual English/Chinese, system/light/dark appearance, index backup/restore.

The quota configurations are inherited from 1.8.5 and are not new entitlement research. Exact provider balance is unknown. No Plus allowance is extrapolated from subscription multipliers.

## Indexing and ongoing sync — unchanged

History acquisition widens through 24 hours, 7 days and 30 days, including regular, archived and eligible Project sources. Conversation-count progress is not a time estimate: large conversations can hold a percentage for longer. A failed source remains a coverage gap rather than a false success.

Unchanged conversations are skipped only when their update timestamp and proven coverage allow it. Wider periods can require older pages. Native Web Locks serialize scanners and storage writes; successful pages are checkpointed so another active tab can resume.

Defaults remain backend reconciliation every **15 minutes**, experimental instant live capture **off**, and reconcile-on-open **off**. Recent refresh rotates four Projects per cycle; a Project can therefore lag one interval. All suspended/closed tabs mean work waits for an active tab.

The shared request counter and pauses are client-side safeguards, not a reverse-engineered official token bucket. Auto/Conservative/Fast retain their 40/25/55 request budgets. HTTP 429 cooldowns and the 45-second recovery pacing remain unchanged. Uninstalling or clearing storage loses these local states too.

## Privacy and limitations

The saved index uses message/conversation identifiers, timestamps, model/effort, coverage/checkpoints, settings and diagnostics. The normal capture pipeline does not persist chat bodies or authentication tokens. Backups contain account-scoped metadata and should be treated as private files. Import only backups you trust, for the same ChatGPT account.

Archived chats are included. Deleted-before-capture, temporary or otherwise missing replies cannot be reconstructed. Retaining a recorded reply after its conversation was deleted is intentional for observed historical usage. Saved replies do not necessarily correspond one-to-one to provider billing or message-limit events.

## Repository and release history

- Current release: [RELEASE_NOTES_1.9.0.md](RELEASE_NOTES_1.9.0.md)
- Older release notes: [archive/release-notes](archive/release-notes/README.md)
- Source/preservation review: [docs/REVIEW_1.9.0.md](docs/REVIEW_1.9.0.md)
- Prior shipped-source fingerprint: [docs/BASELINE_1.8.5.json](docs/BASELINE_1.8.5.json)

The prior `main` was still at 1.7.3 when this release was prepared. 1.9.0 is based on the hash-verified **distributed 1.8.5 ZIP**, not that outdated runtime. Historical notes are retained verbatim and are not retroactive assertions that every old Git publishing attempt succeeded.

## Testing and packaging

Requirements: Python 3.10+, Node 22+, Pillow, Playwright Python and Chromium (`/usr/bin/chromium` in the current harness).

```bash
python tools/test.py
python tools/package.py
```

The suites cover the preserved features plus separate metadata disclosure and returning-index states. HTTP, storage and Web Locks are mocked in browser integration tests. Extension-ID derivation is checked statically; this environment blocks native extension pages, so native Chrome upgrade retention and Orion/iPad are not certified.

`tools/package.py` validates JavaScript, referenced files, PNGs, stable identity and unchanged 1.8.5 functional modules; it creates a deterministic ZIP under `dist/` with `BUILD.json` hashes. No private signing key is bundled.
