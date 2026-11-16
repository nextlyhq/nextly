/**
 * A retired column's drop runs only while the schema lock is held, and carries
 * the run's claim, so a run that lost the lock drops nothing and a run taking
 * it over can find the statement.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { getCoreSchema } from "../../../schemas";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { reconcileCore } from "./core-reconcile";
import { resolveDataLossConsent } from "./data-loss-consent";

const lock = vi.hoisted(() => ({ held: true }));

vi.mock("../pipeline/schema-lock", async importOriginal => ({
  ...(await importOriginal<typeof import("../pipeline/schema-lock")>()),
  assertSchemaLockHeld: async () => {
    if (!lock.held) throw new Error("schema lock lost");
  },
  markedForSchemaLock: (statement: string) => `/* claim */ ${statement}`,
}));

describe("a retired column's drop and the schema lock", () => {
  let testDb: TestDb;
  const desired = getCoreSchema("postgresql");
  const live: NextlySchemaSnapshot = {
    tables: desired.tables.map(table =>
      table.name === "dynamic_collections"
        ? {
            ...table,
            columns: [
              ...table.columns,
              { name: "access_rules", type: "jsonb", nullable: true },
            ],
          }
        : table
    ),
  };

  beforeEach(async () => {
    testDb = await createTestDb();
    lock.held = true;
  });

  const run = (executeSql: (sql: string) => Promise<unknown>) =>
    reconcileCore({
      db: testDb.db,
      dialect: "postgresql",
      introspect: () => Promise.resolve(live),
      applyCore: vi.fn(),
      executeSql,
      // Counting reads the database; this one is a SQLite stand-in.
      consent: resolveDataLossConsent({
        flag: "dynamic_collections.access_rules",
      }),
      markUnrecordedVerifications: async () => 0,
      bindIssuedTokens: async () => ({ bound: 0, removed: 0 }),
      ensureLedger: async () => {
        throw new Error("no ledger here");
      },
    });

  it("carries the run's claim", async () => {
    const executeSql = vi.fn().mockResolvedValue(undefined);
    await run(executeSql);
    expect(executeSql).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/\* claim \*\/ ALTER TABLE .dynamic_collections. DROP COLUMN .access_rules./
      )
    );
  });

  it("is not run once the lock is lost", async () => {
    lock.held = false;
    const executeSql = vi.fn();
    await expect(run(executeSql)).rejects.toThrow("schema lock lost");
    expect(executeSql).not.toHaveBeenCalled();
  });
});
