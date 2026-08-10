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
import { createTestNextly as createThroughPublishedEntry } from "nextly/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../database/factory";
import { clearServices } from "../../di/register";
import { takeAbortedTransactionSightings } from "../aborted-transaction-sightings";
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

  it("records the abort even when the callback swallows it and returns normally", async () => {
    current = await createTestNextly({ dialect: "postgresql" });

    // No rejection to observe from out here: the callback catches its own failure and returns,
    // so PostgreSQL accepts the COMMIT, downgrades it to a rollback, and `transaction()`
    // resolves over a transaction that kept nothing. This is the shape the bulk write paths
    // produce when they record a per-item error and move to the next item.
    await current.adapter.transaction(async tx => {
      try {
        await tx.execute("SELECT 1 FROM a_relation_that_does_not_exist");
      } catch {
        // Swallowed on purpose: this is the pattern being guarded against.
      }
    });

    const sightings = takeAbortedTransactionSightings();
    expect(sightings.length).toBeGreaterThan(0);
    expect(sightings[0]).toMatch(/current transaction is aborted/);
  });

  it("records an abort raised through the published entry point", async () => {
    // The harness reaches tests two ways: this file imports the source module, while suites that
    // import `nextly/testing` get the copy bundled into `dist/testing.mjs`. Those are separate
    // module instances, so a buffer held in module scope would give them one array each — the
    // bundled harness would record an abort that the shared assertion, reading the source array,
    // never sees. That failure is silent and it fails open, which is the one outcome a guard
    // must not have. Holding the buffer on `globalThis` gives both instances the same array.
    const viaPublished = await createThroughPublishedEntry({
      dialect: "postgresql",
    });
    try {
      await expect(
        viaPublished.adapter.transaction(async tx => {
          try {
            await tx.execute("SELECT 1 FROM a_relation_that_does_not_exist");
          } catch {
            // Swallowed on purpose: this is the pattern being guarded against.
          }
          await tx.execute("SELECT 1");
        })
      ).rejects.toThrow();
    } finally {
      await viaPublished.destroy();
    }

    // Read through the source module. Seeing the sighting here is the assertion: it can only
    // have arrived from the bundled harness, so the two instances share one buffer.
    const sightings = takeAbortedTransactionSightings();
    expect(sightings.length).toBeGreaterThan(0);
  });

  it("stays silent when nothing aborts", async () => {
    current = await createTestNextly({ dialect: "postgresql" });

    await current.adapter.transaction(async tx => {
      await tx.execute("SELECT 1");
    });

    expect(takeAbortedTransactionSightings()).toEqual([]);
  });
});

describe("instrumenting an adapter more than once", () => {
  it("installs the guard exactly once across boots", async () => {
    // Handing the same adapter back to `createTestNextly` is how a test keeps a database alive
    // across boots. Each boot instruments the adapter, so without a marker the second boot would
    // wrap the first wrapper: one abort would then report twice, and every transaction would carry
    // a probe for every boot that ever happened.
    //
    // Asserted on the identity of the installed method rather than by counting sightings, because
    // re-wrapping necessarily replaces it with a new closure. Reboots the adapter the way the
    // builder suites do — a caller-owned in-memory adapter, and `clearServices` rather than
    // `destroy`, since the latter disconnects the adapter the second boot needs.
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);

    const first = await createTestNextly({ adapter });
    const afterFirstBoot = first.adapter.transaction;
    expect(first.adapter).toBe(adapter);

    clearServices();
    const second = await createTestNextly({ adapter });
    try {
      expect(second.adapter.transaction).toBe(afterFirstBoot);
    } finally {
      await second.destroy();
    }
  });
});
