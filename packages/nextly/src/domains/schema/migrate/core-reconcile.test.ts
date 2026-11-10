/**
 * @module domains/schema/migrate/core-reconcile.test
 * @since v0.0.3-alpha (Plan C2)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { getCoreSchema } from "../../../schemas";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { reconcileCore } from "./core-reconcile";

describe("reconcileCore (Phase 1)", () => {
  let testDb: TestDb;
  const desired = getCoreSchema("sqlite");

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("is a no-op when live core schema already matches desired", async () => {
    const applyCore = vi.fn();
    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      introspect: () => Promise.resolve(desired), // live == desired → empty diff
      applyCore,
    });
    expect(result.changed).toBe(false);
    expect(applyCore).not.toHaveBeenCalled();
  });

  it("applies an additive diff and records a core_apply event", async () => {
    // live is missing one table → diff is purely additive (add_table).
    const live: NextlySchemaSnapshot = {
      tables: desired.tables.slice(1),
    };
    const applyCore = vi
      .fn()
      .mockResolvedValue({ statementsExecuted: ["CREATE TABLE …"] });

    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      introspect: () => Promise.resolve(live),
      applyCore,
    });

    expect(result.changed).toBe(true);
    expect(applyCore).toHaveBeenCalledOnce();

    const rows = testDb.sqlite
      .prepare(
        "SELECT event_type, status FROM nextly_schema_events WHERE event_type = 'core_apply'"
      )
      .all() as Array<{ event_type: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("applied");
  });

  it("refuses a destructive diff under production-strict (no override)", async () => {
    // live has an extra table not in desired → diff includes drop_table.
    const live: NextlySchemaSnapshot = {
      tables: [
        ...desired.tables,
        {
          name: "legacy_extra",
          columns: [{ name: "id", type: "text", nullable: false }],
        },
      ],
    };
    const applyCore = vi.fn();

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        introspect: () => Promise.resolve(live),
        applyCore,
        allowDestructive: false,
      })
    ).rejects.toMatchObject({ code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED" });
    expect(applyCore).not.toHaveBeenCalled();
  });

  // A live snapshot with one EXTRA table the desired lacks → diff(live → desired)
  // must DROP it (destructive). Reuses the proven extra-table pattern above.
  function liveWithExtraTable(): NextlySchemaSnapshot {
    return {
      tables: [
        ...desired.tables,
        {
          name: "legacy_extra",
          columns: [{ name: "id", type: "text", nullable: false }],
        },
      ],
    };
  }

  it("dev-loose applies a destructive diff when confirmDestructive returns true", async () => {
    const live = liveWithExtraTable();
    const applyCore = vi
      .fn()
      .mockResolvedValue({ statementsExecuted: ["DROP TABLE …"] });
    const confirmDestructive = vi.fn().mockResolvedValue(true);

    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      mode: "dev-loose",
      confirmDestructive,
      introspect: () => Promise.resolve(live),
      applyCore,
    });

    expect(confirmDestructive).toHaveBeenCalledOnce();
    expect(applyCore).toHaveBeenCalledOnce();
    expect(result.changed).toBe(true);
  });

  it("dev-loose aborts when confirmDestructive returns false", async () => {
    const live = liveWithExtraTable();
    const applyCore = vi.fn();
    const confirmDestructive = vi.fn().mockResolvedValue(false);

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        mode: "dev-loose",
        confirmDestructive,
        introspect: () => Promise.resolve(live),
        applyCore,
      })
    ).rejects.toMatchObject({ code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED" });
    expect(applyCore).not.toHaveBeenCalled();
  });
  it("dev-loose asks nothing about a drop its push strips, says it is left in place, and applies the rest", async () => {
    const live = liveWithExtraTable();
    const applyCore = vi
      .fn()
      .mockResolvedValue({ statementsExecuted: ["CREATE INDEX …"] });
    const confirmDestructive = vi.fn().mockResolvedValue(true);
    const warnings: string[] = [];

    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      mode: "dev-loose",
      confirmDestructive,
      introspect: () => Promise.resolve(live),
      applyCore,
      planPush: () =>
        Promise.resolve({
          runnable: [],
          blocked: ['DROP TABLE "legacy_extra";'],
          degraded: false,
        }),
      logger: { info: () => {}, warn: line => warnings.push(line) },
    });

    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(warnings.join("\n")).toMatch(/Left in place: .*legacy_extra/);
    expect(applyCore).toHaveBeenCalledOnce();
    expect(result.changed).toBe(true);
  });

  it("dev-loose asks only about the destructive changes its push makes", async () => {
    const live = liveWithExtraTable();
    live.tables.push({
      name: "legacy_other",
      columns: [{ name: "id", type: "text", nullable: false }],
    });
    const applyCore = vi.fn().mockResolvedValue({ statementsExecuted: [] });
    const confirmDestructive = vi.fn().mockResolvedValue(true);

    await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      mode: "dev-loose",
      confirmDestructive,
      introspect: () => Promise.resolve(live),
      applyCore,
      // The push strips one drop and runs the other.
      planPush: () =>
        Promise.resolve({
          runnable: ['DROP TABLE "legacy_other";'],
          blocked: ['DROP TABLE "legacy_extra";'],
          degraded: false,
        }),
    });

    expect(confirmDestructive).toHaveBeenCalledOnce();
    const asked = (confirmDestructive.mock.calls[0]?.[0] ?? []) as string[];
    expect(asked.join("\n")).toContain("legacy_other");
    expect(asked.join("\n")).not.toContain("legacy_extra");
  });
});
