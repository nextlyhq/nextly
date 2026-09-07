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

A dashboard card stops showing itself as loading once its own data has arrived, instead of waiting for every other card on the page.

A dashboard asking for more than thirty widgets' data is split into several requests that finish independently, but every card was reading one page-wide "still loading" flag. A card whose own request had already answered went on dimming numbers it had, until the last unrelated request finished — most visible on the largest dashboards, where the split happens. Each card now reads the state of the request that carries it, which is also what the published `WidgetComponentProps.isFetching` describes and what a plugin author is told to use to tell a first load from a widget that asks for nothing.
