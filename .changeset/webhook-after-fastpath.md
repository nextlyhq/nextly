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

Deliver webhooks immediately after a content write instead of waiting for the
next scheduled drain.

After a write records an event, Nextly now schedules a bounded delivery pass via
Next.js `after()`, so the first attempt runs as soon as the response is sent —
without adding any latency to the write. It degrades gracefully: it does nothing
when there are no enabled endpoints, when the runtime has no `after()` (Next 14,
or a non-Next context like the CLI), or on any failure — the scheduled
`/webhooks/drain` trigger remains the backstop and owns retries and the backlog.
