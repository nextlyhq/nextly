/**
 * The tag that runs a spec on every database dialect.
 *
 * The browser suite runs in full on SQLite. Its PostgreSQL and MySQL runs
 * (`E2E_DB_DIALECT`, `playwright.config.ts`) run only the tests carrying this
 * tag: the locking and conflict specs, whose behaviour is decided in the
 * database (a claim's lease, its expiry and a document's version, all compared
 * on the database's own clock). Tag a whole file's tests through its describe:
 *
 *   test.describe("…", { tag: EVERY_DIALECT }, () => { … });
 *
 * and it runs on all three with nothing else to wire.
 */
export const EVERY_DIALECT = "@every-dialect";
