---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Add `nextly webhooks:prune` and rename the webhook secret column

`nextly webhooks:prune` runs a webhook-queue retention pass on demand (with
`--dry-run`), so self-hosters without a running drain can reclaim the event
ledger and delivery log from a cron job. See the new "Webhook queue retention
& VACUUM" guide.

The webhook signing-secret column is renamed from `secret_hash` to
`secret_ciphertext`, since it holds encrypted secrets rather than a hash. The
rename is applied automatically during `nextly migrate` (and run-on-boot),
in place and idempotently, so existing endpoints keep their secrets with no
action required.
