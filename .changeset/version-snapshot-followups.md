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

Two defects in how a past version renders, both found in review.

Selecting a second version while the panel stayed open left the previous version's values on screen
under the new version's heading. The form read its values once when it mounted, and the panel does
not remount it between selections; it now follows a changed snapshot itself, so the correct
behaviour belongs to the component rather than to every caller remembering to remount it.

Structured fields could render empty for a version that plainly held something. A snapshot is
captured from the persisted row, so a JSON-backed field arrives as text on SQLite and as an object
on Postgres and MySQL, and a boolean arrives in any of four spellings. Those values are now read
into runtime shapes before the editor sees them, through the same coercion the diff and the value
kit already use.
