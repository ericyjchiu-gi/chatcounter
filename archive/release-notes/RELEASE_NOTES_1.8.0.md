# v1.8.0 — Explicit onboarding and progressive indexing

## First-run experience

- Fresh installations open a dedicated product landing screen.
- Opening Meter makes no ChatGPT history request.
- **Start indexing** switches directly to the full dashboard and begins the baseline.
- Existing, migrated, partial, or completed accounts bypass onboarding and open the dashboard.

## Conversation-count progress

- Baseline stages now finish lightweight source discovery before message-detail indexing.
- Sync & History displays the active 24h/7d/30d step, conversations found, conversations indexed, percentage, current activity, and retained checkpoint.
- Percentage is `completed conversations / discovered conversations`; it does not estimate time or message/page volume.
- Large conversations can hold progress at one percentage for an extended period.
- If Projects are unavailable, progress is explicitly labelled as known history rather than a complete denominator.

## Progressive dashboard

- Range controls show `✓`, a percentage, discovery state, or `—`.
- Partial counts use `≥` and are labelled as recorded so far.
- The selected dashboard gradually brightens as coverage increases.
- Fully indexed ranges remove the partial warning and minimum-count notation.
- Healthy completed Sync & History still auto-collapses; manual collapse remains respected.

## Ongoing capture defaults

- New accounts default to backend reconciliation every **15 minutes**.
- Experimental instant live capture is now **off by default** and remains available as a toggle.
- Reconcile-on-open remains off.
- Existing account settings are preserved.

## Rate-limit governor

- Historical request budgets: Auto 40, Conservative 25, Fast 55.
- HTTP 429 continues to enforce the server `Retry-After` cooldown.
- A 429 also starts a five-minute recovery mode with at least 45 seconds between requests.
- No UI control bypasses server cooldowns.

## Preserved capabilities

Cross-tab native locking, durable checkpoints, staged 24h→7d→30d acquisition, Project discovery, changed-conversation reconciliation, optional live capture, plan detection, trend charts, raw model table, manual reset assumption, CSV export, structured errors, diagnostics export, source circuits, rebuild, pause/resume, and account-isolated storage remain available.

## Validation

- 19 base browser regressions passed.
- 15 prior stability/source-order tests passed.
- 7 v1.8 onboarding/progress/rate-governor/icon tests passed.
- JavaScript syntax, manifest references, package contents, and transparent icon dimensions are validated during packaging.
