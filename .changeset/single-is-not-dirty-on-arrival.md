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

A single no longer reports itself edited before anyone has typed.

A structural field stored as `null` — a component or group, `seo: null` in the
playground — was taken verbatim as the form's default. Its inputs then
materialise the shape as they register, so the form's values could never equal
its defaults and the document was dirty from the moment it loaded. Visible as a
permanent "Not saved" indicator and an always-enabled Save button.

A stored null for a non-repeatable component or group now falls through to the
structural default, which is the shape the form will actually hold. Fixed in the
entry editor too, where the same code carries the same latent defect and only
avoided it because those documents omit the key rather than storing null.

With that gone, the unsaved-changes guard is mounted for singles as well: leaving
a single with real edits now asks first, and leaving an untouched one does not.
