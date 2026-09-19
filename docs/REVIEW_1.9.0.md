# Source review — 1.8.5 to 1.9.0

## Baseline

The source of truth is the distributed `chatcounter-v1.8.5-universal.zip`. Its BUILD.json hashes were validated before editing. `BASELINE_1.8.5.json` retains those fingerprints. The Git main runtime was 1.7.3, so using that as the development baseline would have removed 1.8.x functionality.

## Findings and decisions

| Area | Observed in 1.8.5 | 1.9 decision |
|---|---|---|
| Raw metadata | Nested inside `.usage-block`, visually attached to chart | Move the existing disclosure outside; explicit localized button |
| Stable manifest key | Already present in actual shipped ZIP | Preserve exactly; new key would change identity |
| Account storage | `cmm_v17_state_` plus account/user hash; schema 3 | Preserve |
| Returning screen | `fresh()` checks baseline start and saved events/conversations | Preserve; test complete and paused/partial states |
| Uninstall | Extension storage is not an independent persistent database | Document export/import; do not imply automatic recovery |
| Shared governor | Shared burst counter, pauses, recovery; not a fitted server token bucket | Preserve, correct README terminology |
| Settings | Dedicated language/theme/reset/backup page | Preserve |
| Quota math | Existing reference plan configurations | Preserve; no new service-limit claims |
| Public release | `main` behind distributed ZIP | Publish current source and archive historic notes |

## Explicitly out of scope

No change to quota windows, model classification, message-count semantics, capture defaults, endpoint requests, pagination, Project ordering/rotation, recurrence, cooldown, shared locking or storage migrations. This is a constrained UI/release-management patch. It does not claim to fix all previously discussed limitations or establish exact provider quota balance.

## Regression approach

Retain the 19 + 15 + 7 + 8 prior feature checks, updating only release-version assertions/report labels. Add metadata-disclosure and startup/identity checks. Automated byte comparisons guard seven functional modules against drift. Core and translation modules are compared with only version strings normalized.

A native Chrome identity/storage test was attempted; extension management/pages were blocked by the execution environment. Its outcome is documented as unverified, not silently replaced by a mock pass. Chrome documentation supports stable-key identity and uninstall deletion, but actual Orion update behaviour still needs device validation.
