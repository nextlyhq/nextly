---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

**Breaking (plugin authors):** `ctx.services.collections.createEntry`, `updateEntry` and
`deleteEntry` now resolve to `{ message, item, warnings? }` instead of the bare row.

This is the same envelope the Direct API and the REST API already return, so the same failure is
equally visible however the write was made. Previously a plugin was the ONLY caller of a write
that could not see a post-commit hook failure: `afterCreate` / `afterUpdate` / `afterDelete` run
once the row is durable, so a handler failing there cannot un-save it — the write reports success
and the failure travels beside it as `warnings`. The plugin facade never opened a collector, so
those failures were invisible to the plugin that caused them.

Migration is one property access:

```ts
// Before
const post = await ctx.services.collections.createEntry(slug, data, {
  as: "system",
});
post.id;

// After
const { item, warnings } = await ctx.services.collections.createEntry(
  slug,
  data,
  { as: "system" }
);
item.id;
if (warnings) ctx.logger.warn("side effects failed", { id: item.id, warnings });
```

`deleteEntry` reports `item` as `{ id }`, since there is no row left to return. Reads
(`listEntries`, `findEntryById`, `count`) and `createMany` are unchanged.
