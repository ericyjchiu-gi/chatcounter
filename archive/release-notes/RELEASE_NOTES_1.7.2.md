# v1.7.2 — Stage-aware Project coverage

## Scheduling correction

v1.7.1 correctly isolated failing Projects from core history, but its queue priority was too coarse: it completed 24h, 7d and 30d regular/archived history before returning to eligible Project work. This could make a 24h model card look materially incomplete while 30d core backfill was already running.

v1.7.2 changes baseline ordering to:

1. 24h core (regular + archived)
2. 24h Projects, when eligible
3. 7d core
4. 7d Projects, when eligible
5. 30d core
6. 30d Projects

A Project 5xx/network backoff or shared source circuit still does not block wider core history. When its retry becomes eligible, the older-stage Project task is selected at the next page boundary before more recent-stage core work continues.

## Throttle behaviour

The existing 2–5 minute stage-transition rest applies to the next core stage. It no longer delays healthy Project coverage for the stage that just completed. Burst-budget pauses still stop all historical work, including Projects. HTTP 429 / Retry-After remains a hard, non-overridable cooldown.

## Upgrade

The storage schema and account-scoped keys are unchanged. Update in place and refresh ChatGPT tabs. Existing v1.7.1 checkpoints are resumed: if 24h Projects are still pending while 7d/30d core has begun, those eligible Project tasks move ahead of the next core page without discarding cached replies.
