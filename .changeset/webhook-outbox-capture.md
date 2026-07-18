---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
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

Add the webhook transactional-outbox capture.

`recordEvent` is the single choke-point every write path calls to durably record a content event inside the caller's transaction, so the event commits atomically with the change and can never be lost or fired for a rolled-back change. It writes only the `nextly_events` row; fan-out to endpoints happens later in the drain, keeping content writes fully decoupled from the webhook registry (the canonical transactional-outbox split). Also adds `sensitiveFieldNames`, the password/hidden strip policy (walking nested groups, repeaters, and blocks) that feeds the envelope builder.
