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

A ranged widget query validates again unchanged, and settings say what they may hand back.

- **Widget queries:** a timeseries over a `range` carries no `limit` once validated, so what `validateWidgetQuery` returns validates again unchanged. A widget declaring a `limit` number setting beside a ranged query is refused at registration and as a contribution, since its range sets how many points are drawn.
- **`applyWidgetSettings`** returns `AskedQuery<T>`: the query as declared with each setting applied, or, for a titled list set to a collection it cannot title, the same with no `source` and no `select`. The type is exported from `nextly/config`.

All of it is `@experimental` while the content widgets are built.
