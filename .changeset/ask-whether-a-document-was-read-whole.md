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

Plugins and hosts can now ask which components a block document references
AND whether the whole document could be read, through `componentUsageIn`.

The existing `componentIdsIn` answers only the first half: it walks under a
node budget and stops silently, so a document too large to read whole returns
the same empty list as one referencing nothing. That is the wrong way round
for anything deciding whether a component is still in use, because "references
nothing" is the answer that allows deleting it. `componentIdsIn` keeps its own
signature and result, and is now derived from the richer answer, so the two
cannot drift apart.

`componentIdsIn` and `componentUsageIn` now refuse a `maxNodes` of `NaN`
instead of walking without a bound. `NaN` never satisfied the stop test, so
the budget was not merely loose, it was absent — a document of any size was
read whole. Any other numeric budget behaves as before.
