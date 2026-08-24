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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

Let a plugin see the app's Singles.

`ctx.services` has always been able to answer "what collections exist and what is in them", and had no counterpart for Singles — so a plugin sweeping the app's documents silently covered only half of it. `ctx.services.singles.list()` returns the declared Singles and their field definitions.

Read-only and registry-only: it returns no Single's content and creates nothing. That last part is deliberate rather than incidental, because a read-shaped call on the Single path is not free of side effects in general — the readable half of the preview check creates a Single's row when it is absent, and a plugin walking every Single to build an index would otherwise bring every Single in the app into existence as a side effect of looking.

Singles are addressed by slug here, because a Single's row may not exist until something writes to it, so its row id is not a name a caller can hold.
