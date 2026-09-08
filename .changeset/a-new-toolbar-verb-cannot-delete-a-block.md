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

A toolbar verb added later cannot silently delete a block.

The bar's dispatch was a chain of `else if` ending in a bare `else verbs.delete()`, so a verb added to `ToolbarActionId` and not wired to a handler did not fail to compile — it fell through to the last arm and removed the block the author had selected.

Measured, the way it would actually have happened: adding an id makes the icon map fail with `TS2741` and left the dispatch silent, so the compiler pointed at the missing icon, a developer supplied one, and the new button then deleted things. The dispatch is a `Record` over the verb set now, so a new verb fails to compile there too — verified by adding one, which raises two errors where it previously raised one.
