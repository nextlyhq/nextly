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

A run that can no longer show it holds the schema lock now stops. That covers `nextly migrate`, `migrate:down`, the boot migrate step, `db:sync`, the development push and the Schema Builder's saves. A run loses the lock when another run took it, or when the run stalled past its lease without confirming it. It then starts no further statement, writes nothing further to the migration ledger, and says it lost the lock, naming the last migration it applied.

A run that takes over a lock whose holder stalled or was killed now first asks the database to stop each statement that holder sent which is still running (PostgreSQL and MySQL), and waits for them to end before it changes anything. If one is still running when the wait is over, the run gives the lock back and stops, naming the statement and its database session. A holder killed while a statement runs leaves a lock that lapses within one lease once no statement of it is running, so the next run proceeds without anyone unlocking it by hand.
