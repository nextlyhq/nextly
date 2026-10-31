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

nextly now connects its cache tag expiry ledger when it starts. With `nextly/cache-handler` and `nextly/cache-handlers` installed, a write made outside a request (a job, the CLI, a script) reaches every instance's cached reads within seconds, instead of waiting for the next request on the instance that made it. While the ledger can't be used, for example before `nextly migrate` has added its table, nextly warns once and keeps the expiry for that process's next request, as before.

The scheduled webhook drain now leaves the ledger prune a share of its time budget when one-purpose secrets or preview links have a backlog, instead of letting those sweeps spend all of it. A `use cache` result with `expire: 0` isn't stored outside development, matching Next.js's own handler, and the incremental handler keeps a bounded record of recent reads during bursts.
