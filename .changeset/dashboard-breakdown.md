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

A reader can add a Breakdown card from a collection's group in the add panel. It shows how that collection's entries divide: by status on a collection with a draft and published lifecycle, otherwise by its first field with choices. Breakdown is offered only on collections with something to divide by, in the add panel and in the card's Collection setting alike. A field guarded by a read rule is never offered as a grouping. A stored grouping that names one falls back to the collection's own grouping, and a query naming one is still refused.

For widget authors, a Group by setting can take its default from the collection with `defaultFrom: "collection"`. A grouped query that leaves its key to such a setting may omit `groupBy`. Both are `@experimental`.
