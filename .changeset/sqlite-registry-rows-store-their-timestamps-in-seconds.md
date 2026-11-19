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

On SQLite, the registry rows `nextly migrate` writes for collections, Singles and field groups now store their timestamps in seconds, as the registries read them. They were written in milliseconds, so such a row read as created tens of thousands of years ahead.

Rows already written that way are repaired: at the end of every `nextly migrate` on SQLite, and once at a start. Migration files generated before this release keep the earlier statement and still write milliseconds when applied; the repair at the end of that same `nextly migrate` run puts them right, so nothing needs regenerating.

Archived translations that were marked unresolved because their owner's row carried such a date are judged again: when the repair corrects an entity's creation date, that entity's unresolved archive rows go back to unknown, and the next restore or teardown gives them their owner's kind. PostgreSQL and MySQL are not affected.
