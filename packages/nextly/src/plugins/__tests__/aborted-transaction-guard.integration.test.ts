/**
 * The aborted-transaction guard has to be seen failing, or it is just a green check.
 *
 * `current transaction is aborted` is PostgreSQL's report that some EARLIER statement in the
 * transaction failed and was swallowed. The shape that produces it — an existence check written
 * as "run a query and catch the failure" — is valid on SQLite and MySQL and fatal on PostgreSQL,
 * so a suite green on two dialects can be quietly broken on the third. The harness records any
 * sighting and `__tests__/setup.ts` fails the test that caused it.
 *
 * This proves the mechanism end to end by inducing exactly that state on purpose: swallow a
 * query against a missing relation inside a transaction, then issue another statement. The test
 * consumes its own sighting, which both asserts the guard saw it and stops the shared `afterEach`
 * from failing this deliberately-broken case.
 *
 * PostgreSQL only. SQLite and MySQL do not poison a transaction on a failed statement, which is
 * the entire reason the guard exists.
 */
import { afterEach, describe, expect, it } from "vitest";

import { takeAbortedTransactionSightings } from "../../__tests__/aborted-transaction-sightings";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const onPostgres = getConfiguredTestDialects().includes("postgresql");

describe.skipIf(!onPostgres)("aborted-transaction guard (integration)", () => {
  it("records the abort so the shared assertion can fail the test that caused it", async () => {
    current = await createTestNextly({ dialect: "postgresql" });

    // Swallow a failure inside the transaction exactly as a naive existence probe would,
    // then carry on. PostgreSQL has already marked the transaction aborted by this point.
    await expect(
      current.adapter.transaction(async tx => {
        try {
          await tx.execute("SELECT 1 FROM a_relation_that_does_not_exist");
        } catch {
          // Swallowed on purpose: this is the pattern being guarded against.
        }
        await tx.execute("SELECT 1");
      })
    ).rejects.toThrow();

    // Consuming the sighting is both the assertion and the cleanup: the shared `afterEach`
    // in setup.ts reads the same buffer, so leaving it full would fail this test for doing
    // precisely what it set out to demonstrate.
    const sightings = takeAbortedTransactionSightings();
    expect(sightings.length).toBeGreaterThan(0);
    expect(sightings[0]).toMatch(/current transaction is aborted/);
  });

  it("stays silent when nothing aborts", async () => {
    current = await createTestNextly({ dialect: "postgresql" });

    await current.adapter.transaction(async tx => {
      await tx.execute("SELECT 1");
    });

    expect(takeAbortedTransactionSightings()).toEqual([]);
  });
});
