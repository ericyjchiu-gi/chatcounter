# Testing

## Current commands

```bash
python tools/test.py
python tools/package.py
```

## Current evidence

`tests/regression_201.py` runs 45 checks against:

- the production service-worker source in a Node VM;
- simulated Chrome storage, alarms, action and read-only backend responses;
- the actual popup renderer in Chromium at 500px;
- source fingerprints written to `tests/results/2.0.1.json`.

Covered areas include popup registration, stable ID, cached-index retention, quota/badge arithmetic, account mismatch, 429 cooldowns, background completion, deduplication/coverage reuse, read-only requests, storage fallback, settings persistence, tooltip/disclosure behavior and compact geometry.

## Not certified by this environment

- native extension installation or actual toolbar click behavior;
- real authenticated ChatGPT endpoints and anti-bot/cookie behavior;
- Chrome storage persistence across a real upgrade;
- Orion/iPad behavior.

These boundaries must be checked manually before public-store release. CI installs Chromium and runs the same current suite; old reports are not counted as current evidence.
