---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-commerce": patch
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

The dashboard has a Needs attention card, in place of Unpublished changes. It shows what is waiting for the reader, each as a link to exactly what it counts:

- entries with unpublished changes, per collection, and each Single with them;
- entries a scheduled release will publish in the next 7 days, per collection;
- overdue releases, linking to the Releases list's overdue filter.

Only kinds with something waiting are shown, and "All clear" when there are none. A kind the reader may not read is left out entirely, and a reader who may read none of them sees the card as not available. Counts stop at 99 per collection, and at 20 collections per kind, and then read "99+" or "N+". A small card shows the total and a short link per kind, a medium one a row per kind, and a large one each kind per collection.

A saved dashboard's Unpublished changes card becomes the Needs attention card, keeping its place, or merges into a Needs attention card the dashboard already holds.

Compatibility:

- `CoreWidgetId` no longer includes `"core/pending-edits"`. A plugin naming it in `instead` or `alternatives` should name `"core/needs-attention"`.
- A grouped widget result's buckets may carry `atLeast: true`, saying that bucket's count is a floor. Additive: a reader that ignores it reads every bucket as before.
- New, experimental: the `system:attention` widget source, and `nextly/attention-keys`, the kinds and bucket keys its answer uses.
