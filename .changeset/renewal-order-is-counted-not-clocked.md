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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

Deciding which of two overlapping heartbeats answered most recently was done by
comparing the time each was sent. That reads the wall clock, and a wall clock can
go backwards — an NTP correction, a virtual machine resuming, somebody setting the
time by hand. After a correction, a later heartbeat carries a SMALLER number than
an earlier one, so the editor holding the document would ignore every subsequent
answer about a colleague waiting until the clock caught up, which for a large
correction is minutes or never.

Which reply is newer is a question about order, not about elapsed time, so it is
now decided by counting the heartbeats rather than by timing them. How much lease
is left is still measured with the clock, because that is a duration and only a
clock can answer it.
