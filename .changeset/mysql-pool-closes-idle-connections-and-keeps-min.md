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

A MySQL pool now closes idle connections and keeps `pool.min` (`DB_POOL_MIN`), as the PostgreSQL pool does. Outside Vercel it kept every connection it opened, whatever `pool.idleTimeoutMs` (`DB_POOL_IDLE_TIMEOUT`) said, and ignored `pool.min`; now a connection above `pool.min` closes once it has been idle that long, and the defaults are PostgreSQL's: `min` 0 and 30 seconds. Compatibility: a long-running server now closes connections idle for 30 seconds and opens new ones as needed. To keep them open as before, set `DB_POOL_MIN` to the pool's maximum (10 by default, or your `DB_POOL_MAX`), or pass `pool: { idleTimeoutMs: 0 }` to the adapter.
