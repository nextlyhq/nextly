/**
 * @nextlyhq/plugin-sdk/testing — the integration harness (D46).
 *
 * Re-exports `createTestNextly` from `nextly/testing` so plugin authors can
 * boot a real Nextly and integration-test their plugin's lifecycle, hooks, and
 * events. In-memory SQLite by default; pass `dialect` to boot against a real
 * PostgreSQL or MySQL server, and use `getAvailableTestDialects` to skip
 * cleanly on a machine where that server is not running.
 *
 * @public Graduated in P9 — exercised by every first-party plugin's test suite
 *   (D46). See `STABILITY.md`.
 */
export {
  createTestNextly,
  getAvailableTestDialects,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "nextly/testing";
