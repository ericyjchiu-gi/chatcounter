# Privacy and data handling

## Stored locally

- account-scoped hashed index key
- message and conversation IDs
- reply timestamps
- model slug and reasoning-effort label
- source/range coverage and pagination checkpoints
- request pacing, retry and source-health metadata
- user settings and allowlisted diagnostic events

## Not stored

- chat text or attachments
- access tokens
- raw response bodies
- authentication/request headers
- browsing history outside `chatgpt.com`

## Network access

The extension is limited to `https://chatgpt.com/*` and uses GET requests for session and saved-history reconstruction. Optional live capture observes completed replies generated in a ChatGPT page and emits only selected metadata fields.

## Local export

Index backups contain metadata and coverage state, not chat content or authentication material. Import requires a compatible schema and matching signed-in account.

## Limitations

Saved-history reconstruction cannot see conversations deleted before observation, temporary chats, or every failed generation. Usage estimates are therefore lower bounds in some circumstances and are not the provider's private quota ledger.
