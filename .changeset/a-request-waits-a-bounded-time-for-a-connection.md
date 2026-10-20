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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A request now waits a bounded time for a database connection on every dialect, and past the bound fails instead of waiting without end, as "database busy" where the error reaches the request boundary (see "Where it shows" below).

- **The setting:** `pool.connectionTimeoutMs`, default 15 seconds (20 on Neon, from the PostgreSQL adapter's provider defaults), with the same meaning on PostgreSQL, MySQL and SQLite. `0` waits without limit.
- **Where it shows:** route handlers, server actions, sign-in and the REST dispatcher answer `DATABASE_BUSY`. Collection and Single entry reads and writes still answer 500 `INTERNAL_ERROR` when the database is busy, as before.
- **The error:** `DATABASE_BUSY`, status 503, with `data.retryAfterSeconds` of 5 and a `Retry-After: 5` header on REST. The statement or transaction that waited did not run. Anything the request committed before it stays committed, so a request that writes in several steps is safe to repeat only where those steps are.
- **PostgreSQL:** the timing is unchanged; the pool already gave up after 15 seconds. What changes is the answer: it was a 500 `INTERNAL_ERROR`, and is now `DATABASE_BUSY`.
- **MySQL (behaviour change):** a request that found every connection in use used to wait in mysql2's queue without limit. It now fails after `pool.connectionTimeoutMs`, unless you raise it. The time a new connection gets to open (`connectTimeout`) also moves from 10 to 15 seconds, so it matches PostgreSQL; a connection that cannot open in time is still a connection error, not `DATABASE_BUSY`.
- **SQLite:** a transaction waits at most `pool.connectionTimeoutMs` for the one connection behind the transactions ahead of it. A write blocked by another process holding the database file past `busyTimeout` (`SQLITE_BUSY`) is now `DATABASE_BUSY` too, where it was a 409 `CONFLICT`. `SQLITE_LOCKED` stays a `CONFLICT`.
- **Retry-After:** it is now set for any error carrying `data.retryAfterSeconds`, not only `RATE_LIMITED`.
- **For adapter authors:** the adapters raise the busy error with the code `NEXTLY_POOL_WAIT_TIMEOUT`, exported from `@nextlyhq/adapter-drizzle/types` as `POOL_WAIT_TIMEOUT_CODE`, with `poolWaitTimeoutError()` to raise it.

See [When the database is busy](https://nextlyhq.com/docs/guides/deployment#when-the-database-is-busy) in the production guide.
