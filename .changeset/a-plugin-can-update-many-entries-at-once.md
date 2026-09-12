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

A plugin can update many entries in one call. `ctx.services.collections` ended at `createMany`: plugin code could write many rows in one call and then had no way to change them in one, elevated or not, so the only batch update available to it was a loop of `updateEntry` calls, each with its own transaction, its own access pass and its own cache flush. `updateMany(slug, entries, opts?)` takes one `{ id, data }` per row, so a single call can apply a different patch to each row, and returns the same `BatchOperationResult` `createMany` returns: partial success, with `errors[].index` indexing the array the caller passed. There is deliberately no by-filter form; `listEntries` and this method compose to the same thing with the rows named, and a filter that matches more than its author meant is the failure a batch write cannot take back. A `locale` is refused by name, as on `createMany`, because the bulk pipeline writes in one pass and cannot store a translation. `@experimental` on the plugin surface until a first-party plugin exercises it.
