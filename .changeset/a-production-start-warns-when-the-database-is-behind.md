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

A production start now reads the database's schema version once and compares it with the build's, the newest migration in the app's migrations folder, which `withNextly` names (pass `migrationsDir` to `withNextly` if you changed `db.migrationsDir`) and `instrumentation.ts` hands to `createRegister` as `buildSchemaVersion: process.env.NEXTLY_BUILD_SCHEMA_VERSION`, so it reaches Nextly on Vercel and with `output: "standalone"` too; new apps and the templates pass it. A database behind the build logs one warning naming both versions and saying to run `nextly migrate`; one ahead of it (an older build still serving) logs one line at info level. Either way the app keeps serving and nothing is written. `nextly migrate`, `migrate:down`, Schema Builder saves and plugin installs and uninstalls now store that version in the same transaction as the registry rows they write.
