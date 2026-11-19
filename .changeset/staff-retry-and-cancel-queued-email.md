---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

Staff can retry and cancel a queued email.

- **Retry:** `POST /api/email-deliveries/queued/:id/retry` (Direct API: `nextly.email.retryQueued({ id })`) retries a queued email now while its message is held.
  - A waiting or retrying email has its next attempt brought forward to now.
  - A failed email waits again, due now, with a fresh set of attempts. Its last failure shows until the next attempt replaces it.
  - A template email is rendered from its template as saved at that moment, so a retry after fixing the template sends the fixed version.
  - It is refused (`CONFLICT`, saying why) while an attempt is with the provider, and for an email already sent or cancelled, or whose message has been cleared.
- **Cancel:** `POST /api/email-deliveries/queued/:id/cancel` cancels as `nextly.email.cancelQueued` does. While an attempt is with the provider, the cancel is a request: it takes effect only if that attempt fails.
- **Permissions:** both need `manage-email-deliveries`, seeded to super-admin only.
- **Recorded:** each retry and cancel by a person is written to the activity log as an update under `email-deliveries`, naming the queued email and the action. No address is recorded.
- A queued email whose attempt stopped after its send was recorded now keeps the provider that sent it, read from that send's delivery records.
