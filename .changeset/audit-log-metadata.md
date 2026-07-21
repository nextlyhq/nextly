---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
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

Security events are recorded again.

The audit log stores who signed in, who failed to, and what changed. Events that carry extra detail, such as a rejected request or a failed sign-in, were being dropped on SQLite: the detail is stored as text there but as a structured value on PostgreSQL and MySQL, and the wrong one was being sent. The write failed, and because a failed audit write is deliberately not allowed to interrupt whatever the user was doing, nothing surfaced.

The effect was a log that looked healthy while missing exactly the entries worth reading. Routine events carry no detail and were saved normally; failed sign-ins and rejected requests carry detail and were not. Anyone reviewing that log after a suspicious event would have seen ordinary activity and no sign of the attempt.
