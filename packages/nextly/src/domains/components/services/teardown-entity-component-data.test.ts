/**
 * Failure-handling contract for the embedded-component sweep.
 *
 * The sweep addresses component tables through the ORM, which resolves them via the schema
 * registry. A `comp_` table can sit in the catalog with no registered schema, and that must
 * not abort an entity delete. Everything else must abort it: a delete that reports success
 * while rows survive is the failure mode this guards.
 *
 * The dialect behaviour (nesting, parent-id scoping, companion rows) is covered against real
 * databases in `__tests__/entity-delete-component-data.integration.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";

import { teardownEntityComponentData } from "./teardown-entity-component-data";

const UNREGISTERED =
  'Table "comp_ghost" not found in schema registry. Ensure setTableResolver() has been called during boot.';

/**
 * Adapter whose `select` fails with `error` for the named table only. `rowsForParent`
 * drives the raw count used to decide whether skipping that table is safe.
 */
function makeAdapter(failingTable: string, error: unknown, rowsForParent = 0) {
  return {
    dialect: "postgresql" as const,
    listTables: vi.fn().mockResolvedValue(["comp_hero", failingTable]),
    tableExists: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(1),
    executeQuery: vi.fn().mockResolvedValue([{ n: rowsForParent }]),
    select: vi.fn(async (table: string) => {
      if (table === failingTable) throw error;
      return [];
    }),
  };
}

describe("teardownEntityComponentData failure handling", () => {
  it("skips a table with no registered schema when it holds no rows for this entity", async () => {
    const adapter = makeAdapter("comp_ghost", new Error(UNREGISTERED), 0);

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(result.skippedTables).toEqual(["comp_ghost"]);
    // The resolvable table was still swept rather than abandoned alongside it.
    expect(adapter.select).toHaveBeenCalledWith("comp_hero", expect.anything());
  });

  it("fails the delete when an unaddressable table still holds rows for this entity", async () => {
    // Skipping here would let the caller drop the parent table while those rows survive,
    // and report success — the outcome this sweep exists to prevent.
    const adapter = makeAdapter("comp_ghost", new Error(UNREGISTERED), 4);

    await expect(
      teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: "dc_posts",
      })
    ).rejects.toThrow();
  });

  it("rethrows a genuine database failure instead of reporting a clean sweep", async () => {
    // A connection drop must not be reclassified as "no schema, nothing to clean" — that
    // would let the caller drop the parent table while component rows survive.
    const adapter = makeAdapter(
      "comp_ghost",
      new Error("Connection terminated unexpectedly")
    );

    await expect(
      teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: "dc_posts",
      })
    ).rejects.toThrow("Connection terminated unexpectedly");
  });

  it("probes an unresolvable table once, not once per parent", async () => {
    const adapter = makeAdapter("comp_ghost", new Error(UNREGISTERED));

    await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    const ghostProbes = adapter.select.mock.calls.filter(
      c => c[0] === "comp_ghost"
    );
    expect(ghostProbes).toHaveLength(1);
  });
});
