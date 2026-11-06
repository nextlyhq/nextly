---
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Page Builder usage counts are exact only when they are. A failed usage index write now marks the index dirty, and the count reads as a floor until a full rebuild has walked the site again; a later save no longer hides it. A backfill pass that a newer run has replaced, because the plugin's `limits` changed or a write failed, writes nothing. A collection too large for one job resumes where the last job stopped instead of starting again. The backfill's progress lives in the plugin's own tables, which no admin screen or API reaches, so a row added by hand to the old `nx_pb_usage_backfill` collection changes nothing.

The plugin now declares database tables, `page_builder__usage_runs` and `page_builder__usage_progress`, with schema version 1. Development creates them at boot. A production site applies the shipped migration with its usual `nextly migrate` step before it starts on this version.

`ctx.db.transaction(fn, { isolation: "snapshot" })` opens a read-only transaction whose reads all see one moment: REPEATABLE READ on PostgreSQL and MySQL, and SQLite's serial transaction. A write through it is refused.
