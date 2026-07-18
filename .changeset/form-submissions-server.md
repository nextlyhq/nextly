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

Form submissions get an honest server: spam is stored and flagged instead of silently deleted, exports can be real CSV, and submission counts stop lying.

**Spam is never silently dropped anymore.** Honeypot and reCAPTCHA hits are stored with `status: "spam"` and the detection reason, so a false positive stays reviewable and recoverable — the bot still sees the same fake success, no notification emails fire for flagged rows, and rate-limit hits are still rejected without storage. This also fixes a bug where honeypot detection could never fire at all: the spam check ran on schema-transformed data, which had already stripped the undeclared honeypot fields (and a form's real `website` field can no longer trip the trap either).

**CSV export is real.** `GET …/submissions/export?format=csv&form=<id>` streams a CSV with columns from the form's fields plus metadata, named after the form and date. Exports page through everything, respect form/status filters, and exclude spam unless you ask for it. The JSON format remains the default.

**`submissionCount` on forms is now a real number** (spam excluded) instead of a hardcoded 0.

**Admin edits of submitted data leave a trace**: new `editedAt`/`editedBy` stamps are set whenever the submission `data` changes, and a new `spamReason` field records what flagged a submission.

**Removed**: the never-mounted `SubmissionList`/`SubmissionDetail` components and the `@nextlyhq/plugin-form-builder/components` subpath that existed only to export them. The builder-config endpoint now also returns the resolved forms/submissions collection slugs so admin components work under slug overrides.
