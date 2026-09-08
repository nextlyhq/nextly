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

Retire the per-page `usedClasses` record in favour of the class-usage index.

Two mechanisms answered "which documents reference this class". `usedClasses`
was a hidden JSON field on each page holding the ids its document referenced;
`nx_pb_class_usage` is a queryable index maintained on every write. The field
was written on four paths and read by nothing but its own rebuild deciding
whether to rewrite it, so it could not answer the question it was kept for —
that answer already came from the index.

Removed, and therefore breaking for anyone importing them:

- `rebuildClassUsage`, and the `PageUsageStore` and `RebuildReport` types.
  `rebuildClassUsageIndex` is the equivalent and rebuilds the index the
  plugin actually reads. The two names differed by one word while doing
  unrelated things, so a host wiring the repair path could reach the one that
  maintains nothing.
- The `usedClasses` field on the `pages` collection, with the `beforeChange`
  hook that derived it.
- The `limits` option on `pagesCollection`. Nothing consumed it once the
  derivation went, and an option that is accepted and ignored is worse than
  one that is absent.

Hosts that called `rebuildClassUsage` should call `rebuildClassUsageIndex`,
which takes the collection, field, locale and variant it walks.

The `pages.usedClasses` COLUMN needs a deliberate schema step, because the
field leaving the collection makes it live-only and the diff emits
`drop_column` for it. What happens next depends on the classifier mode:

- `dev-additive`, which is the HMR boot-apply path: the drop is skipped with
  a warning and the column stays.
- Interactive sync: a destructive-drop confirmation naming the table and the
  row count.
- `production-strict`, which is migrate Phase 1: the sync REFUSES while any
  destructive operation is present, so a deploy stops until the drop is taken
  deliberately.

Taking the drop is safe — the column holds a derived value nothing reads —
but it is a data-losing operation and this does not perform it for you.
