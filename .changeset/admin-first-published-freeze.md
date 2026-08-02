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

Keep the durable first-publication marker on every shape the entry editor uses, and let the
editor trust it. A published entry that was unpublished and then reloaded no longer offers its
slug back to the title generator, so republishing lands at the address the links already point
at. The marker is consulted only for a slug shared by every language, because it records that a
document was public somewhere rather than in one particular language.

The marker also survives editing: a document with a pending working draft now reports it on the
save response and on the draft read, as a date rather than a string, matching an ordinary read.
