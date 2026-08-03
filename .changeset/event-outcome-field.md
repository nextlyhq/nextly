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

Record the outcome of every event the outbox captures. `success | failure |
unknown` is the vocabulary the audit and observability schemas converge on, and
the one field NIST SP 800-53 AU-3(e) requires that the envelope did not already
carry.

Absence means success, which is what every event recorded so far is: a row is
written inside the transaction of a change that commits, so a recorded event is
by construction a completed one — and that is also why the column's default is
the correct value for existing rows. The field exists so that a refusal, such as
a denied publish, can be recorded as the distinct thing it is rather than being
indistinguishable from a change that happened.

Additive and optional on the webhook envelope, so existing subscribers are
unaffected.
