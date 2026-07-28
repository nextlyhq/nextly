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

    // The rejection must identify the offending table, so an operator can act on it and a
    // regression that probes the wrong table cannot pass.
    await expect(
      teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: "dc_posts",
      })
    ).rejects.toMatchObject({
      logContext: expect.objectContaining({
        componentTable: "comp_ghost",
        parentTable: "dc_posts",
        rows: 4,
      }),
    });
  });

  it("checks an unaddressable table against nested levels, not only the entity table", async () => {
    // The table holds no rows parented to dc_posts, but does hold rows parented to the
    // registered comp_hero instances deleted at the level below. Checking only the entity
    // table would skip it and strand those rows.
    const adapter = {
      dialect: "postgresql" as const,
      listTables: vi.fn().mockResolvedValue(["comp_hero", "comp_ghost"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(1),
      select: vi.fn(async (table: string) => {
        if (table === "comp_ghost") throw new Error(UNREGISTERED);
        // comp_hero yields one instance, forming the next frontier.
        return [{ id: "h1" }];
      }),
      // Zero rows under dc_posts. Two under comp_hero, but ONLY when the probe also
      // constrains to the h1 instance — so dropping the nested `_parent_id` clause makes
      // this return zero and the test fail, rather than passing on the table name alone.
      executeQuery: vi.fn(async (_sql: string, params?: unknown[]) =>
        params?.[0] === "comp_hero" && params.includes("h1")
          ? [{ n: 2 }]
          : [{ n: 0 }]
      ),
    };

    await expect(
      teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: "dc_posts",
        maxDepth: 3,
      })
    ).rejects.toMatchObject({
      logContext: expect.objectContaining({
        componentTable: "comp_ghost",
        parentTable: "comp_hero",
        rows: 2,
      }),
    });
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

describe("teardownEntityComponentData table discovery", () => {
  /**
   * Adapter whose catalog and registry disagree: the registry holds a component
   * stored under a custom, unprefixed name that prefix discovery cannot match.
   */
  function makeCustomNameAdapter() {
    const deleted: string[] = [];
    return {
      deleted,
      adapter: {
        dialect: "postgresql" as const,
        listTables: vi
          .fn()
          .mockResolvedValue(["comp_hero", "seo_meta", "dynamic_components"]),
        tableExists: vi.fn().mockResolvedValue(false),
        delete: vi.fn(async (table: string) => {
          deleted.push(table);
          return 1;
        }),
        executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
        select: vi.fn(async (table: string) => {
          if (table === "dynamic_components") {
            return [
              { slug: "hero", table_name: "comp_hero" },
              { slug: "seo", table_name: "seo_meta" },
            ];
          }
          // One instance of each component belongs to the entity being deleted.
          return [{ id: `${table}-1` }];
        }),
      },
    };
  }

  it("visits a registered component table that carries no comp_ prefix", async () => {
    const { adapter, deleted } = makeCustomNameAdapter();

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(result.tablesTouched).toContain("seo_meta");
    expect(deleted).toContain("seo_meta");
  });

  it("does not treat the registry table itself as component storage", async () => {
    const { adapter, deleted } = makeCustomNameAdapter();

    await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(deleted).not.toContain("dynamic_components");
  });
});

describe("teardownEntityComponentData unmaterialized components", () => {
  it("ignores a registered component whose table was never created", async () => {
    // A pending or failed component: its registry row names a table the
    // catalog does not have. Probing it would raise a missing-table error and
    // block the entity delete entirely.
    const probed: string[] = [];
    const adapter = {
      dialect: "postgresql" as const,
      listTables: vi
        .fn()
        .mockResolvedValue(["comp_hero", "dynamic_components"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(0),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      select: vi.fn(async (table: string) => {
        if (table === "dynamic_components") {
          return [
            { slug: "hero", table_name: "comp_hero" },
            { slug: "pending", table_name: "comp_pending" },
          ];
        }
        probed.push(table);
        return [];
      }),
    };

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(probed).not.toContain("comp_pending");
    expect(result.skippedTables).not.toContain("comp_pending");
  });
});

describe("teardownEntityComponentData registry safety", () => {
  it("never sweeps the registry table even when a row names it", async () => {
    const probed: string[] = [];
    const adapter = {
      dialect: "postgresql" as const,
      listTables: vi
        .fn()
        .mockResolvedValue(["comp_hero", "dynamic_components"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(0),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      select: vi.fn(async (table: string) => {
        if (table === "dynamic_components") {
          // A component whose dbName collides with the registry itself.
          return [{ slug: "bad", table_name: "dynamic_components" }];
        }
        probed.push(table);
        return [];
      }),
    };

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(probed).not.toContain("dynamic_components");
    expect(result.tablesTouched).not.toContain("dynamic_components");
  });
});

describe("teardownEntityComponentData registry read failures", () => {
  it("propagates a registry read failure instead of sweeping without it", async () => {
    // Continuing here would silently drop every custom-named component from
    // the sweep, reporting a successful delete while those rows survive.
    const adapter = {
      dialect: "postgresql" as const,
      listTables: vi
        .fn()
        .mockResolvedValue(["comp_hero", "dynamic_components"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(0),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      select: vi.fn(async (table: string, options?: { where?: unknown }) => {
        // The resolvability probe must succeed so the real read is reached.
        if (table === "dynamic_components" && !options?.where) {
          throw new Error("connection terminated");
        }
        return [];
      }),
    };

    await expect(
      teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: "dc_posts",
      })
    ).rejects.toThrow(/connection terminated/);
  });
});

describe("teardownEntityComponentData catalog case folding", () => {
  it("matches a registered name against a differently-cased catalog entry", async () => {
    // MySQL with lower_case_table_names reports the folded name.
    const deleted: string[] = [];
    const adapter = {
      dialect: "mysql" as const,
      listTables: vi.fn().mockResolvedValue(["seo_meta", "dynamic_components"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(async (table: string) => {
        deleted.push(table);
        return 1;
      }),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      select: vi.fn(async (table: string) => {
        if (table === "dynamic_components") {
          return [{ slug: "seo", table_name: "SEO_META" }];
        }
        return [{ id: `${table}-1` }];
      }),
    };

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(result.tablesTouched).toContain("seo_meta");
    expect(deleted).toContain("seo_meta");
  });
});

describe("teardownEntityComponentData case-distinct catalogs", () => {
  it("keeps case-distinct tables separate when both exist", async () => {
    // PostgreSQL, and MySQL with lower_case_table_names=0, can hold both.
    const deleted: string[] = [];
    const adapter = {
      dialect: "postgresql" as const,
      listTables: vi
        .fn()
        .mockResolvedValue(["SEO_META", "seo_meta", "dynamic_components"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(async (table: string) => {
        deleted.push(table);
        return 1;
      }),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      select: vi.fn(async (table: string) => {
        if (table === "dynamic_components") {
          return [
            { slug: "upper", table_name: "SEO_META" },
            { slug: "lower", table_name: "seo_meta" },
          ];
        }
        return [{ id: `${table}-1` }];
      }),
    };

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(result.tablesTouched).toContain("SEO_META");
    expect(result.tablesTouched).toContain("seo_meta");
  });
});
