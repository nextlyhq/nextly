/**
 * The code an adapter gives the error it raises when a request has waited out
 * `pool.connectionTimeoutMs` for a database connection, as core reads it.
 *
 * Read here rather than imported from `@nextlyhq/adapter-drizzle/types`, where
 * the adapters define it, because the module that reads it
 * (`database/errors.ts`) is reached from `NextlyError` and so from every
 * client-safe entry: a runtime import of a database package there puts that
 * package in the admin's browser bundle. A leaf with no imports keeps this
 * reachable without the adapter.
 *
 * The same string as the adapters' `POOL_WAIT_TIMEOUT_CODE`, held to it by
 * `errors/__tests__/database-busy.test.ts`, so the two cannot drift apart
 * unnoticed.
 */
export const POOL_WAIT_TIMEOUT_CODE = "NEXTLY_POOL_WAIT_TIMEOUT";
