/**
 * @nextlyhq/plugin-sdk/testing — the integration harness (D46).
 *
 * Re-exports `createTestNextly` from `nextly/testing` so plugin authors can
 * boot a real Nextly and integration-test their plugin's lifecycle, hooks, and
 * events. In-memory SQLite by default; pass `dialect` to boot against a real
 * PostgreSQL or MySQL server, and use `getConfiguredTestDialects` to run only
 * the dialects a machine has been configured for.
 *
 * @public Graduated in P9 — exercised by every first-party plugin's test suite
 *   (D46). See `STABILITY.md`.
 */
export {
  createTestNextly,
  getConfiguredTestDialects,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "nextly/testing";
