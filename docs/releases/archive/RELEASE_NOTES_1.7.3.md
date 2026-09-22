# v1.7.3 — Projects endpoint fix and extension icon

## Projects HTTP 500

Diagnostics showed regular, archived and conversation-detail requests returning HTTP 200 while only Project discovery failed quickly and repeatedly with HTTP 500. The first sidebar request was incorrectly sent as:

```text
/backend-api/gizmos/snorlax/sidebar?cursor=0
```

The sidebar and per-Project conversation endpoints use different first-page conventions. v1.7.3 now requests the Projects sidebar as:

```text
/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0
```

It appends `cursor` only after the server returns an opaque continuation cursor. Per-Project conversation listing still starts with `cursor=0`.

On upgrade, never-successful saved sidebar tasks are requeued with the corrected first-page request. Their stale 500/backoff records are cleared without deleting cached replies, conversations, core coverage or per-Project progress.

## Extension icon

Adds the supplied flat chat-analytics artwork as 16, 32, 48 and 128 px PNG icons. The off-white tile is retained and the outer rounded corners are transparent so Chrome/Orion can render the extension icon cleanle.

## Validation

Validated JavaScript syntax, manifest references, icon dimensions/alpha, corrected first-page query, opaque-cursor continuation and saved-state migration in offline Chromium fixtures. ChatGPT history endpoints are private and undocumented, so real-account verification remains necessary.
