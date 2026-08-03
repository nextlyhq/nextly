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

Record a `login-succeeded` audit event when a session is issued.

Failed logins have been recorded since the audit log shipped; successes were
not. A trail of failures alone shows that someone tried and not whether they got
in, which is the first question asked after a credential leak.

The event is written only where a session actually exists. The multi-factor
challenge and forced-password-change legs both return HTTP 200 without issuing
one, so recording on status alone would report that an account was reached when
it was not.

Unlike the failure event it is attributed to the account. Naming the account on
a failure is the account-state leak the unified error response exists to avoid;
on a success it is the whole value of the record.
