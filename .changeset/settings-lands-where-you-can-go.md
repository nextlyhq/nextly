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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The Settings entry in the admin sidebar now sends each reader to the first
destination in the panel they can actually open, read off the panel's own
navigation table rather than a list maintained beside it.

An operator whose only settings-area grant was `manage-background-jobs` saw
the Settings entry, followed it, and landed on General Settings — a page whose
data answers to `manage-settings` and returns 403 — because the landing was a
hand-written chain of seven destinations that Background Jobs had never been
added to. Their one reachable screen was never offered.

A destination is now skipped when its own route is guarded more narrowly than
the link that shows it, so a reader holding only `read-api-keys` is no longer
sent to a page that turns them away.
