---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fire due webhook deliveries with a drain trigger.

Adds `/api/webhooks/drain` (GET or POST): one request fans out due events into
deliveries and attempts them, so a scheduler (e.g. Vercel Cron, which triggers
with a GET) can drive delivery and retries. Until now the delivery engine had no
production trigger and the event outbox accumulated rows nothing sent.

The route is authorized by a shared secret presented as a bearer token
(constant-time compare) — either `NEXTLY_DRAIN_SECRET` or Vercel's `CRON_SECRET`
— OR by an authenticated admin/API-key caller with `update-webhooks`. The
endpoint registry is now a shared singleton, so a change made through the webhook
admin API invalidates the same cache a running drain reads instead of waiting for
a per-drain cache to expire.
