---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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

nextly: record what email was sent, and what failed

A failed password-reset previously left no durable trace — the adapter threw,
the service returned `{ success: false }`, one line went to the process log,
and the operator learned from the user. Sends are now recorded in
`email_deliveries`.

The table stores a **hash** of the recipient rather than the address, and a
template slug rather than a rendered subject, so it answers "did this send" and
"how many failed" without answering "to whom". Provider failure messages have
address-shaped text removed before storage, because an SMTP rejection quotes
the recipient back at you.

This is a log, not a queue: nothing drains it, and the retry columns it carries
are reserved and inert so that adding a drain later is not a migration on a
table already holding history.
