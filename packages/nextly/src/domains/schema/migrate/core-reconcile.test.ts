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

    // The live tables before the push, then as the push left them: the run
    // checks every declared column is there once it has pushed.
    const introspect = vi
      .fn()
      .mockResolvedValueOnce(live)
      .mockResolvedValue(desired);
    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      introspect,
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

  /**
   * The desired core schema with one column of another type than declared:
   * the diff changes its type, a destructive change the push makes.
   */
  function liveWithChangedType(): NextlySchemaSnapshot {
    const [first, ...rest] = desired.tables;
    const column = first.columns.find(c => c.primaryKey !== true);
    if (column === undefined) throw new Error("no ordinary column to change");
    return {
      tables: [
        {
          ...first,
          columns: first.columns.map(c =>
            c === column ? { ...c, type: "integer" } : c
          ),
        },
        ...rest,
      ],
    };
  }

  /** Introspection that reads `live` first, then the tables as declared. */
  function introspectThenDeclared(live: NextlySchemaSnapshot) {
    return vi.fn().mockResolvedValueOnce(live).mockResolvedValue(desired);
  }

  it("the development boot applies a type change and keeps a retired table, naming the consent that drops it", async () => {
    const live = liveWithChangedType();
    live.tables.push({
      name: "legacy_extra",
      columns: [{ name: "id", type: "text", nullable: false }],
    });
    const applyCore = vi
      .fn()
      .mockResolvedValue({ statementsExecuted: ["ALTER TABLE …"] });
    const executeSql = vi.fn();
    const warnings: string[] = [];

    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      allowDestructive: true,
      introspect: introspectThenDeclared(live),
      applyCore,
      executeSql,
      logger: { info: () => {}, warn: line => warnings.push(line) },
    });

    expect(applyCore).toHaveBeenCalledOnce();
    expect(executeSql).not.toHaveBeenCalled();
    expect(warnings.join("\n")).toMatch(/Left in place: .*legacy_extra/);
    expect(warnings.join("\n")).toContain(
      "with the consent --accept-data-loss=legacy_extra"
    );
    expect(result.changed).toBe(true);
  });

  it("with nothing but a retired table, and nobody to drop it, changes nothing", async () => {
    const applyCore = vi.fn();
    const executeSql = vi.fn();

    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      allowDestructive: true,
      introspect: () => Promise.resolve(liveWithExtraTable()),
      applyCore,
      executeSql,
      logger: { warn: () => {} },
    });

    expect(applyCore).not.toHaveBeenCalled();
    expect(executeSql).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });

  it("judges every destructive change, a type change among them, by the consent", async () => {
    const judgeDeletions = vi.fn().mockRejectedValue(new Error("refused"));
    const applyCore = vi.fn();
    const live = liveWithChangedType();
    const changed = live.tables[0];

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        introspect: () => Promise.resolve(live),
        applyCore,
        judgeDeletions,
      })
    ).rejects.toThrow("refused");

    expect(judgeDeletions).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "column",
        table: changed.name,
        core: true,
        reason: expect.stringContaining("type changes from integer"),
      }),
    ]);
    expect(applyCore).not.toHaveBeenCalled();
  });

  it("refuses a push it cannot plan with a named error naming the table and the release to migrate with first", async () => {
    const { UnplannablePushError } = await import("../pipeline/fresh-push");
    const applyCore = vi
      .fn()
      .mockRejectedValue(new UnplannablePushError("resolver crashed"));

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        introspect: () => Promise.resolve({ tables: desired.tables.slice(1) }),
        applyCore,
      })
    ).rejects.toMatchObject({
      code: "NEXTLY_CORE_UPGRADE_UNSUPPORTED",
      publicMessage: expect.stringMatching(
        new RegExp(
          `${desired.tables[0].name}.*npx nextly@0\\.0\\.2-alpha\\.65 migrate`
        )
      ),
    });
  });

  it("names the columns still missing after the push, never reporting success", async () => {
    const live: NextlySchemaSnapshot = { tables: desired.tables.slice(1) };
    const applyCore = vi.fn().mockResolvedValue({ statementsExecuted: [] });

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        // The push ran, and the table is still not there.
        introspect: () => Promise.resolve(live),
        applyCore,
      })
    ).rejects.toMatchObject({
      code: "NEXTLY_CORE_UPGRADE_INCOMPLETE",
      publicMessage: expect.stringContaining(`table ${desired.tables[0].name}`),
    });
  });
});
