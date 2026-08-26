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

A language switch that was refused no longer fills a language later. Asking to
start one language from another travels with a navigation, and on a dirty form
the unsaved-changes guard holds that navigation until the author answers. When
they chose "Keep Editing" the request stayed behind — so reaching that language
afterwards by any other route, browser history or a later switch, opened a copy
confirmation for something declined minutes earlier, with nothing on screen to
explain why.

The guard now says when it was refused, and both ways out of it count: the
button and dismissing with Escape. Confirming still carries the request through,
which is the case that must keep working — reporting a refusal there would drop
the intent at the one moment it was meant to be honoured.
