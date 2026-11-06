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

Core's own writes now rely on the transaction scope the adapters share, on every dialect.

- A version-number race on a versioned collection or Single is retried inside the adapter's transaction rather than around it, still up to three attempts. A lost attempt's after-commit effects are dropped with it and its after-rollback effects never run. When the write runs inside a transaction someone else opened, the conflict reaches that outermost transaction instead of being retried by the inner call alone. When every attempt loses, the caller still gets a 409.
- A migration refuses to run inside an open transaction on every dialect, before any of its work runs. On MySQL its DDL would otherwise commit the enclosing transaction implicitly.
- Creating a user inside a plugin's `ctx.db.transaction` no longer fails with a 500 on PostgreSQL and MySQL: the new account is read back inside its own transaction, which has joined the plugin's and not yet committed.
- Creating a user with roles, assigning a role and removing one inside a transaction someone else opened (a plugin's `ctx.db.transaction`) now flush the user's cached access once that transaction commits, not before. A permission check made while it was still open could otherwise keep the user's old access until another change to roles retired it.
