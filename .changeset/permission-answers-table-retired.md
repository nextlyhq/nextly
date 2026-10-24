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

The `user_permission_cache` table is retired. Nothing has read it since permission answers stopped being stored, so a new install no longer creates it. While an existing database still has it, every access change empties it before the role version is published, so an instance still running an earlier release that reads it, even one upgrading past the release in between, never serves a revoked grant from it. An existing database keeps it, and the startup warning names it with its row count, until `nextly migrate` runs with `NEXTLY_DROP_RETIRED_AUTH_TABLES=1`. That drops it even when it holds rows, since they were only copies of answers recomputed from roles, and logs the drop; `NEXTLY_DROP_NONEMPTY_RETIRED` still governs only the retired `accounts` and `sessions` tables. Until the drop, on MySQL, where the table has no foreign key to `users`, a deleted user's rows stay in it; they name only the user's id and permissions.

The `userPermissionCache` schema export, deprecated in the previous release, is removed from `nextly`, `nextly/schemas` and the dialect schemas in `nextly/database`, together with the `users.permissionCache` relation. Nothing in Nextly reads the table, so code that queried it reads only answers no longer written; remove those queries. The name `user_permission_cache` is reserved, so an app table cannot take it.
