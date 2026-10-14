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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A plugin can limit attempts on keys it chooses, before the work they guard runs (`@experimental`). It declares named rules in `contributes.limits`: rolling windows, or a growing wait after attempts in a row. The app refuses to start on a rule outside the documented bounds. The plugin then reserves through `ctx.limits` on 1 to 16 entries, each a rule and a key. A reservation is decided and counted atomically in the selected limit store, so instances sharing it admit no more than the rules allow. Each entry chooses whether it can refuse (`enforce`) and when it counts (`count`), and gets its own verdict back. `release`, `reset`, `check` and `clientKey` are there too. A store that can't answer gives `unavailable`, never an admission. Keys are stored only as keyed hashes, namespaced to the plugin. The types are exported from `@nextlyhq/plugin-sdk`.
