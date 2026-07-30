import { beforeAll, afterAll, afterEach } from "vitest";

import { takeAbortedTransactionSightings } from "../plugins/test-nextly";

beforeAll(() => {
  // Setup test environment
  console.log("🧪 Setting up nextly tests...");
});

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
 * no individual test knows to look for it. This shape was found repeatedly by reading code
 * while the suite stayed green; this is the suite learning to see it.
 *
 * Runs after EVERY test so the failure is attributed to the test that caused it rather than to
 * whichever one happens to run last.
 */
afterEach(() => {
  const sightings = takeAbortedTransactionSightings();
  if (sightings.length === 0) return;
  throw new Error(
    `A PostgreSQL transaction was aborted during this test, which means an earlier ` +
      `statement inside it failed and was swallowed. Find the swallowed error — it is the ` +
      `real defect, and this message is only its shadow. Seen ${sightings.length} time(s):\n` +
      sightings.map(s => `  - ${s}`).join("\n")
  );
});

afterAll(() => {
  // Cleanup
  console.log("✅ nextly tests complete");
});
