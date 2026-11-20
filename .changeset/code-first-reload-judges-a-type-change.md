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

A config reload under `next dev`, and a development start, now judge a code-first field's type change by the values its column holds, as `nextly db:sync` does, instead of skipping every one with a "needs review" warning. A change the database converts is applied (on SQLite, a text holding whole numbers becoming a number). One that would clear a value is refused, naming the rows and the data-loss consent that covers it (`NEXTLY_ACCEPT_DATA_LOSS=<table>.<column>`); with that consent, only those values are cleared. A pair with no conversion Nextly runs (on PostgreSQL and MySQL, a text becoming a number) is held for confirmation at a terminal (`nextly db:sync`), with nothing changed. A translated field's type change is refused as before.
