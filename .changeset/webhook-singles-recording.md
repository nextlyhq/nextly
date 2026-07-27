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

Emit webhook events when a Single changes.

Updating a Single now records a `single.updated` event carrying the written
document and its prior state, and a status change additionally records
`single.published` or `single.unpublished` — so a publish delivers both
`single.updated` and `single.published`, and a consumer can subscribe to
whichever it needs. Events fire whether or not the Single has versioning
enabled, name the locale for a per-language write, and never carry secret
field values.
