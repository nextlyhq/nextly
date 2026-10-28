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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

`system:attention` answers a new `list` query, the attention digest: each reader's open work, read
as that reader at read time, one item per thing waiting. The grouped answer the current Needs
attention card reads is unchanged.

- Each item carries `id`, `kind` (`stopped`, `overdue` or `plugin`), `label`, `count`, `atLeast`
  when the count is a floor, `severity`, an admin-relative `link`, and `failed` when it could not
  be counted (`@experimental`).
- Core's kinds are releases that stopped and overdue releases, both critical, each the releases
  domain's own count, linked to Releases filtered to its reason, and shown only to a reader of
  releases.
- Plugins' attention items (`contributes.dashboard.attention`) now reach the digest as warnings.
  An item with `permission` shows only to a holder of it, and one with `collections` only to a
  reader of one of them. Who may see an item is asked within its own budget, and a check that
  fails or runs out of time hides the item. Its `count` reads only those collections, as the
  reader, and one the reader cannot read answers empty.
- Every item is counted at once, each within its own 10-second budget. One that throws, runs out of
  time or answers something that is not a count fails alone and is logged with its plugin and id.
  Counts above 99 read as 99 and a floor. A reader whose access to releases cannot be read is
  shown neither release kind.
- Startup refuses, in the one dashboard fault message, an attention item that breaks its shape,
  repeats another's id, uses the reserved `core`, `collection` or `single` namespace, names a
  permission other than in its stored `action-resource` form, or is one of more than 10 from a
  plugin. An item naming a collection the site does not have is warned about
  and shows to nobody.
