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

On SQLite, a run that finds the database busy while it takes the schema lock now says who holds it where another Nextly run does. A command waits for that run as for any held lock and then stops with `NEXTLY_MIGRATE_LOCK_BUSY`, naming the command that holds the lock and when it started; a Schema Builder save is refused at once with "A migration is running on this database". Before, both ended with `NEXTLY_TABLE_BUSY` and "its holder is not named". A database busy for any other reason is waited for and reported as before. The lock's later steps wait for a busy database too: the check at the end of a run no longer reports a busy database as "another run took it", a release is tried again so the lock is not left held for its lease, and a run whose work finished but whose lock could not be confirmed ends with `NEXTLY_TABLE_BUSY` saying so. Every wait counts from when the run began taking the lock, so a held lock and a busy database no longer add up: the longest wait is the larger of the two bounds. PostgreSQL and MySQL are unchanged.
