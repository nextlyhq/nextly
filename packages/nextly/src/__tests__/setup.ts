import { beforeAll, afterAll, afterEach, expect } from "vitest";

import { describeAbortedTransactions } from "../plugins/aborted-transaction-sightings";

import {
  describeTransactionEscapes,
  installTransactionEscapeObserver,
  recordTestFileRan,
  recordTransactionEscapes,
  takeTransactionEscapes,
} from "./transaction-escapes";
import {
  CLAIMS_ENV,
  claimWorker,
  releaseWorker,
} from "./worker-database-guard";

// This file's claim on its worker's pool id, and so on its database, for as
// long as its tests run. Vitest may start a slot's next process while the last
// one is still exiting, so the claim is held per file rather than per process:
// what must never happen is two files running at once on one database. Only
// integration runs set the claims directory (their global setup); a unit run,
// which loads this file too, has none.
const claims = process.env[CLAIMS_ENV];
if (claims) {
  const poolId = process.env.VITEST_POOL_ID ?? "unknown";
  beforeAll(() => claimWorker(claims, poolId));
  afterAll(() => releaseWorker(claims, poolId));
}

beforeAll(() => {
  // Setup test environment
  console.log("🧪 Setting up nextly tests...");
});

// A real install always has this: production refuses to boot without it, and
// anything storing a credential refuses to write without it. Leaving it unset
// made the suite exercise a configuration no deployment can be in, so a test
// touching provider credentials failed for a reason unrelated to its subject.
//
// Assigned rather than overwritten, so a run that deliberately supplies its own
// secret keeps it, and a file testing the absent case can still delete it.
process.env.NEXTLY_SECRET ??= "nextly-test-encryption-secret-at-least-32-chars";

// The dialect these suites actually run on. `DB_DIALECT` defaults to
// `postgresql`, which then demands a `DATABASE_URL` — so any unit test whose
// subject happened to read the environment failed validation for a database it
// never touches. The fixtures here are in-memory SQLite, and saying so is what
// makes the environment describe the run rather than contradict it.
//
// Assigned rather than overwritten, like the secret above: an integration run
// that supplies its own dialect keeps it, and a file testing the unset case can
// still delete it.
process.env.DB_DIALECT ??= "sqlite";

/**
 * Fail any test that leaves a PostgreSQL transaction aborted.
 *
 * `current transaction is aborted` is always a SECONDARY error: some earlier statement in the
 * transaction failed and was swallowed, and every statement after it reports this instead. The
 * pattern that produces it is an existence check written as "run a query and catch the
 * failure" — valid on SQLite and MySQL, fatal on PostgreSQL, and therefore invisible to a suite
 * that passes on the first two.
 *
 * Asserted centrally rather than per test, because the failure surfaces far from its cause and
 * no individual test knows to look for it.
 *
 * Runs after EVERY test so the failure is attributed to the test that caused it rather than to
 * whichever one happens to run last. The message comes from the same function published through
 * `nextly/testing`, so this suite and a plugin author's suite report the identical diagnosis;
 * only the assertion differs, because each runner reports its own best.
 */
afterEach(() => {
  const aborted = describeAbortedTransactions();
  if (aborted) expect.fail(aborted);
});

/**
 * Fail any test whose statements ran outside the transaction they were meant
 * to be part of (`./transaction-escapes`).
 *
 * The adapters report a pool access made while the same flow holds an open
 * transaction on PostgreSQL or MySQL; SQLite has one connection and cannot
 * tell. `NEXTLY_TRANSACTION_ESCAPES=report` prints them instead of failing,
 * for taking an inventory of a suite.
 */
installTransactionEscapeObserver();

// The inventory's record that this file ran, so a known escape whose witness
// ran and was not reached shows as fixed (`staleKnownEscapes`).
beforeAll(() => {
  recordTestFileRan(expect.getState().testPath);
});

afterEach(() => {
  const reported = takeTransactionEscapes();
  // Every escape, accepted ones too, goes to the run's inventory when it keeps
  // one (`./transaction-escapes-inventory`), with the file that made it.
  recordTransactionEscapes(reported, expect.getState().testPath);
  const escapes = describeTransactionEscapes(reported);
  if (!escapes) return;
  if (process.env.NEXTLY_TRANSACTION_ESCAPES === "report") {
    console.warn(`[transaction escapes] ${escapes}`);
    return;
  }
  expect.fail(escapes);
});

afterAll(() => {
  // Cleanup
  console.log("✅ nextly tests complete");
});
