/**
 * `nextly/testing` — in-memory integration test harness (D46).
 *
 * Kept on a dedicated subpath so the native SQLite driver and boot machinery
 * stay out of the main `nextly` entry. Re-exported from
 * `@nextlyhq/plugin-sdk/testing` for plugin authors.
 *
 * @module testing
 */

export {
  createTestNextly,
  getConfiguredTestDialects,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "./plugins/test-nextly";

/**
 * The aborted-transaction guard, for suites running against a real PostgreSQL server.
 *
 * `createTestNextly` records any transaction it leaves in PostgreSQL's aborted state, but
 * recording is not asserting: without a per-test check the run still reports green over a
 * transaction that silently discarded its writes. These make the recording readable, so a
 * consumer's own runner can fail the test:
 *
 * ```ts
 * import { describeAbortedTransactions } from "nextly/testing";
 *
 * afterEach(() => {
 *   const aborted = describeAbortedTransactions();
 *   if (aborted) expect.fail(aborted);
 * });
 * ```
 *
 * Nothing here throws, and nothing imports a test framework — that is why the assertion is the
 * caller's to make rather than something installed automatically.
 */
export {
  describeAbortedTransactions,
  takeAbortedTransactionSightings,
  isAbortedTransactionError,
  PG_ABORTED_TRANSACTION_SQLSTATE,
} from "./plugins/aborted-transaction-sightings";

/**
 * The limit store contract, as cases a store can be run through (`@experimental`).
 *
 * An app supplying its own store through `rateLimit.store` runs these against it, one test per
 * case, handing each case two handles on the store as two instances of the site would hold them:
 *
 * ```ts
 * import { limitStoreContract } from "nextly/testing";
 *
 * for (const contractCase of limitStoreContract) {
 *   it(contractCase.name, () => contractCase.run({ first: storeA, second: storeB }));
 * }
 * ```
 *
 * A case that fails throws `LimitStoreContractViolation` with what broke.
 */
export {
  limitStoreContract,
  LimitStoreContractViolation,
  type LimitStoreContractCase,
  type LimitStorePair,
} from "./domains/limits/limit-store-contract";
