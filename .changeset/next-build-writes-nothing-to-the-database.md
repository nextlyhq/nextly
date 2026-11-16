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

`next build` no longer writes to the database. Next.js starts the app while it builds, to prerender pages that read content, and that start used to create missing tables, update the collection registry, run migrations at start when they were turned on, reconcile the email templates, set SQLite's journal mode, and on an empty database create the whole schema. A build may point at a database other deployments share, so Nextly's own start now only reads there. The one write left is sealing a plugin setting that its manifest now marks secret (or that was sealed under a rotated `NEXTLY_SECRET`), which must happen before that plugin starts. A plugin's own `init` and `onReady` code still runs in the build, and what it writes is the plugin's.

A build against a database with no Nextly tables now stops with `NEXTLY_DATABASE_NOT_MIGRATED`: "The database has no Nextly tables. Run `nextly migrate` before `next build`." On SQLite a database file that does not exist yet is not created, and on PostgreSQL a configured `db.postgres.schema` that does not exist is not created; both refuse with the same advice. Run `nextly migrate` before `next build`, as the scaffolded build script already does. Everything the build skipped happens at the first start after it.

`@nextlyhq/adapter-drizzle` exports `isNextBuildPhase()` from the new `@nextlyhq/adapter-drizzle/build-phase` subpath, the one check Nextly and the adapters share.
