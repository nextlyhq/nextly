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

/**
 * The aborted-transaction guard, for a suite booting against a real PostgreSQL server.
 *
 * `createTestNextly` records any transaction it leaves in PostgreSQL's aborted state, which is the
 * signature of a statement that failed inside the transaction and was swallowed. Recording is not
 * asserting: without a per-test check the suite still reports green over a transaction that
 * discarded every write, so a plugin needs this to get the benefit.
 *
 * ```ts
 * import { describeAbortedTransactions } from "@nextlyhq/plugin-sdk/testing";
 *
 * afterEach(() => {
 *   const aborted = describeAbortedTransactions();
 *   if (aborted) expect.fail(aborted);
 * });
 * ```
 *
 * `describeAbortedTransactions` returns the diagnosis or `null`, leaving the assertion to the
 * caller's own runner — nothing here throws, and nothing pulls a test framework into the package.
 * `takeAbortedTransactionSightings` is the raw list for a suite that wants to report it its own
 * way. The error matcher behind them stays on `nextly/testing`, since a consumer classifying
 * driver errors by hand is a sign something else is wrong.
 */
export {
  describeAbortedTransactions,
  takeAbortedTransactionSightings,
} from "nextly/testing";
