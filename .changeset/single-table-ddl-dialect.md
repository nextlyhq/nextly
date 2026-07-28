---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

Singles now get their storage table on MySQL, and on any app configured with only a `DATABASE_URL` rather than an explicit `DB_DIALECT`. The DDL for a Single's table was generated from an optional environment variable that defaults to PostgreSQL instead of from the database the statements were about to run against, and a declared `slug` field was emitted as a type MySQL cannot put a unique index on, so the table was never created and the first read reported it missing.

The plugin test harness can also boot against a real database: `createTestNextly({ dialect: "postgresql" | "mysql" })` creates a dedicated database for that instance and drops it on `destroy()`, and `getConfiguredTestDialects()` reports which dialects the environment is configured for so a suite can cover those and skip the rest. The default is unchanged: in-memory SQLite.
