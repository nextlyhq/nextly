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

A plugin can read the collections it declared without the site's read hooks reshaping
the answer, through `ctx.services.ownCollections` (`@experimental`). The read skips
every configured read hook (collection `beforeOperation`, `beforeRead` and `afterRead`,
including `*` globals and the plugin's own, stored hooks, field hooks set in config, and
the `collections.listQuery` filter). It keeps what a field's type does to make a stored
value readable. It runs as the system only, offers `listEntries`, `findEntryById`,
`count` and `group`, and refuses any collection the plugin did not declare, a dependency's
included, before anything is read. Related rows keep their own collection's hooks. Use
it for a plugin's own bookkeeping; never return its result to a person.
