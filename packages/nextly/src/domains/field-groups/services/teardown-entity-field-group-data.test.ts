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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  introspectLiveColumns,
  liveColumnNames,
} from "../../schema/pipeline/diff/introspect-live";

import {
  countEntityComponentRows,
  countEntityComponentTree,
  teardownEntityComponentData,
} from "./teardown-entity-field-group-data";

// The catalog the sweep asks whether a table it cannot address has a `_parent_table` column:
// every table has one, unless named in `withoutParent`, or given its own columns in `columns`.
// Both of the module's readers answer from it as the real ones do: `introspectLiveColumns` with
// each table and column as the catalog spells it, `liveColumnNames` lower-cased, a later table
// taking the place of one whose name folds to the same.
const catalog = vi.hoisted(() => ({
  withoutParent: new Set<string>(),
  columns: new Map<string, string[]>(),
}));
vi.mock("../../schema/pipeline/diff/introspect-live", async importOriginal => {
  const columnsOf = (table: string) =>
    catalog.columns.get(table) ??
    (catalog.withoutParent.has(table)
      ? ["id", "label"]
      : ["id", "_parent_id", "_parent_table"]);
  return {
    ...(await importOriginal<
      typeof import("../../schema/pipeline/diff/introspect-live")
    >()),
    introspectLiveColumns: vi.fn(
      async (_db: unknown, _dialect: unknown, tables: string[]) => ({
        tables: tables.map(table => ({
          name: table,
          columns: columnsOf(table).map(name => ({ name })),
        })),
      })
    ),
    liveColumnNames: vi.fn(
      async (_db: unknown, _dialect: unknown, tables: string[]) =>
        new Map(
          tables.map(table => [
            table.toLowerCase(),
            new Set(columnsOf(table).map(name => name.toLowerCase())),
          ])
        )
    ),
  };
});
afterEach(() => {
  catalog.withoutParent.clear();
  catalog.columns.clear();
  vi.mocked(liveColumnNames).mockClear();
  vi.mocked(introspectLiveColumns).mockClear();
});

/** The catalog reads made, through either reader. */
const catalogReads = () => [
  ...vi.mocked(introspectLiveColumns).mock.calls,
  ...vi.mocked(liveColumnNames).mock.calls,
];

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
    // The handle the catalog is read through (`liveColumnNames`, mocked above).
    getDrizzle: () => ({}),
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
      getDrizzle: () => ({}),
    };

    await expect(
      teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: "dc_posts",
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

  it("passes over an unaddressable table with no parent column without counting its rows", async () => {
    // The count would name a column the table lacks: on PostgreSQL that failure aborts the
    // delete's transaction, so the catalog is asked instead and no count is sent at all.
    catalog.withoutParent.add("comp_ghost");
    const adapter = makeAdapter("comp_ghost", new Error(UNREGISTERED), 4);

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(result.skippedTables).toEqual(["comp_ghost"]);
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });

  it("reads the catalog once for every table it counts", async () => {
    // One round trip for the columns of every candidate table, not one per table counted.
    const adapter = makeAdapter("comp_ghost", new Error(UNREGISTERED), 2);

    const owned = await countEntityComponentRows({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(owned).toEqual([
      { table: "comp_hero", rows: 2 },
      { table: "comp_ghost", rows: 2 },
    ]);
    expect(catalogReads()).toHaveLength(1);
    expect(catalogReads()[0]?.[2]).toEqual(["comp_hero", "comp_ghost"]);
  });

  it("keeps two tables whose names differ only by case apart, on a server that does", async () => {
    // PostgreSQL holds `comp_Hero` and `comp_hero` as two tables. Only the first has the parent
    // column; read folded, the second would take its place, and the first's rows would count 0
    // where a create over leftover storage asks whether to refuse.
    catalog.columns.set("comp_Hero", ["id", "_parent_id", "_parent_table"]);
    catalog.columns.set("comp_hero", ["id", "label"]);
    const adapter = {
      ...makeAdapter("comp_none", new Error(UNREGISTERED), 3),
      listTables: vi.fn().mockResolvedValue(["comp_Hero", "comp_hero"]),
    };

    const owned = await countEntityComponentRows({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(owned).toEqual([{ table: "comp_Hero", rows: 3 }]);
  });

  it("reads a parent column in another case as the server compares columns", async () => {
    // PostgreSQL keeps `_PARENT_TABLE` a column of its own, which the count would not name:
    // such a table holds no instances. MySQL folds column names, so there it is the column.
    catalog.columns.set("comp_hero", ["id", "_PARENT_TABLE"]);
    const pg = {
      ...makeAdapter("comp_none", new Error(UNREGISTERED), 3),
      listTables: vi.fn().mockResolvedValue(["comp_hero"]),
    };

    expect(
      await countEntityComponentRows({
        adapter: pg as never,
        parentTable: "dc_posts",
      })
    ).toEqual([]);
    expect(pg.executeQuery).not.toHaveBeenCalled();
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
          // A registry row pointing at the registry table itself.
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
  /**
   * A MySQL server that reports `lowerCaseTableNames` for the variable query and
   * a zero count for every other one. Whether the stored `SEO_META` and the
   * catalog's `seo_meta` are one table is decided by that setting, so the mock
   * has to answer it rather than leaving the code to assume.
   */
  function mysqlAdapter(lowerCaseTableNames: number, deleted: string[]) {
    return {
      dialect: "mysql" as const,
      listTables: vi.fn().mockResolvedValue(["seo_meta", "dynamic_components"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(async (table: string) => {
        deleted.push(table);
        return 1;
      }),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      // The variable read goes through Drizzle's `sql` template, so the mock
      // answers on the Drizzle handle and returns the mysql2 `[rows, fields]`
      // shape the real driver produces.
      getDrizzle: vi.fn(() => ({
        execute: vi.fn(async () => [
          [{ lower_case_table_names: lowerCaseTableNames }],
          [],
        ]),
      })),
      select: vi.fn(async (table: string) => {
        if (table === "dynamic_components") {
          return [{ slug: "seo", table_name: "SEO_META" }];
        }
        return [{ id: `${table}-1` }];
      }),
    };
  }

  it("matches a registered name against a differently-cased catalog entry", async () => {
    // lower_case_table_names=1 lowercases names on creation, so the catalog's
    // `seo_meta` is the table the registry recorded as `SEO_META`.
    const deleted: string[] = [];
    const result = await teardownEntityComponentData({
      adapter: mysqlAdapter(1, deleted) as never,
      parentTable: "dc_posts",
    });

    expect(result.tablesTouched).toContain("seo_meta");
    expect(deleted).toContain("seo_meta");
  });

  // The same catalog on a case-sensitive server: `seo_meta` is a different table
  // from the registered `SEO_META`, and deleting its rows would delete another
  // table's data.
  it("leaves a differently-cased table alone on a case-sensitive server", async () => {
    const deleted: string[] = [];
    const result = await teardownEntityComponentData({
      adapter: mysqlAdapter(0, deleted) as never,
      parentTable: "dc_posts",
    });

    expect(result.tablesTouched).not.toContain("seo_meta");
    expect(deleted).not.toContain("seo_meta");
  });

  // The registry is found by the same rules as the tables it names. Gating on an
  // exact match while resolving its rows case-insensitively would skip registry
  // discovery entirely here, leaving every custom-named component out of the
  // sweep and its rows orphaned once the parent is deleted.
  // A malformed row pointing back at the registry resolves to whatever spelling
  // the catalog reports, so excluding only the exact constant would let the
  // registry be probed as an instance table — where a missing `_parent_table`
  // column breaks the delete and a permissive adapter could damage metadata.
  it("never treats the registry as component storage, whatever its case", async () => {
    const deleted: string[] = [];
    const adapter = {
      dialect: "mysql" as const,
      listTables: vi
        .fn()
        .mockResolvedValue(["DYNAMIC_COMPONENTS", "comp_hero"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(async (table: string) => {
        deleted.push(table);
        return 1;
      }),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      getDrizzle: vi.fn(() => ({
        execute: vi.fn(async () => [[{ lower_case_table_names: 1 }], []]),
      })),
      select: vi.fn(async (table: string) => {
        if (table === "dynamic_components") {
          // The malformed row: it points at the registry itself.
          return [{ slug: "broken", table_name: "dynamic_components" }];
        }
        return [{ id: `${table}-1` }];
      }),
    };

    const result = await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    expect(result.tablesTouched).not.toContain("DYNAMIC_COMPONENTS");
    expect(deleted).not.toContain("DYNAMIC_COMPONENTS");
  });

  it("discovers the registry when the catalog reports it in another case", async () => {
    const deleted: string[] = [];
    const adapter = {
      dialect: "mysql" as const,
      listTables: vi.fn().mockResolvedValue(["seo_meta", "DYNAMIC_COMPONENTS"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(async (table: string) => {
        deleted.push(table);
        return 1;
      }),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      getDrizzle: vi.fn(() => ({
        execute: vi.fn(async () => [[{ lower_case_table_names: 1 }], []]),
      })),
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

describe("teardownEntityComponentData follows a deep chain", () => {
  it("deletes every level, whatever the definitions place now, probing each table once", async () => {
    // Six field groups, each with a row parented to the previous level's, beside ten tables that
    // hold nothing of the entity's. No definition places any of them: every one has since stopped,
    // which leaves the rows stored where they were written.
    const chain = ["l1", "l2", "l3", "l4", "l5", "l6"];
    const others = Array.from({ length: 10 }, (_, i) => `x${i}`);
    const parentOf = new Map(
      chain.map((slug, i) => [
        `comp_${slug}`,
        i === 0 ? "dc_posts" : `comp_${chain[i - 1]}`,
      ])
    );
    const probes = new Map<string, number>();
    const reads = new Map<string, number>();
    const deleted: string[] = [];
    type Condition = { column: string; op?: string; value?: unknown };
    // The resolvability probe matches nothing by asking for a row with no id.
    const isProbe = (conditions: Condition[]) =>
      conditions.some(c => c.column === "id" && c.op === "IS NULL");
    const childRowsOf = (table: string, conditions: Condition[]) => {
      const parent = conditions.find(c => c.column === "_parent_table")?.value;
      return parentOf.get(table) === parent ? [{ id: `${table}-1` }] : [];
    };
    const registryRows = [...chain, ...others].map(slug => ({
      slug,
      table_name: `comp_${slug}`,
      fields: [],
    }));
    const adapter = {
      dialect: "postgresql" as const,
      listTables: vi
        .fn()
        .mockResolvedValue([
          ...chain.map(slug => `comp_${slug}`),
          ...others.map(slug => `comp_${slug}`),
          "dynamic_components",
        ]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(async (table: string) => {
        deleted.push(table);
        return 1;
      }),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      select: vi.fn(
        async (table: string, options?: { where?: { and?: Condition[] } }) => {
          if (table === "dynamic_components") return registryRows;
          const conditions = options?.where?.and ?? [];
          const probe = isProbe(conditions);
          const tally = probe ? probes : reads;
          tally.set(table, (tally.get(table) ?? 0) + 1);
          return probe ? [] : childRowsOf(table, conditions);
        }
      ),
    };

    await teardownEntityComponentData({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });

    // Every level of the chain went, though no definition places it.
    expect(new Set(deleted)).toEqual(
      new Set(chain.map(slug => `comp_${slug}`))
    );
    for (const slug of [...chain, ...others]) {
      // Resolvability is the table's, so it is asked once, not once per level.
      expect(probes.get(`comp_${slug}`)).toBe(1);
      // Each level reads every table: the entity's, then each of the six chain levels.
      expect(reads.get(`comp_${slug}`)).toBe(chain.length + 1);
    }
  });
});

describe("countEntityComponentTree", () => {
  it("counts, per table, every row the teardown removes, nested levels and translations included", async () => {
    // Three nested levels under the entity, one instance each, beside a table holding nothing of
    // the entity's; the middle level is translated, with three rows for its instance.
    const chain = ["l1", "l2", "l3"];
    const parentOf = new Map(
      chain.map((slug, i) => [
        `comp_${slug}`,
        i === 0 ? "dc_posts" : `comp_${chain[i - 1]}`,
      ])
    );
    const translated = "comp_l2_locales";
    type Condition = { column: string; op?: string; value?: unknown };
    const isProbe = (conditions: Condition[]) =>
      conditions.some(c => c.column === "id" && c.op === "IS NULL");
    const childRowsOf = (table: string, conditions: Condition[]) => {
      const parent = conditions.find(c => c.column === "_parent_table")?.value;
      return parentOf.get(table) === parent ? [{ id: `${table}-1` }] : [];
    };
    const fake = () => {
      const removed = new Map<string, number>();
      const adapter = {
        dialect: "postgresql" as const,
        listTables: vi
          .fn()
          .mockResolvedValue([
            ...chain.map(slug => `comp_${slug}`),
            "comp_other",
            "dynamic_components",
          ]),
        tableExists: vi.fn(async (table: string) => table === translated),
        delete: vi.fn(async (table: string, where: { and?: Condition[] }) => {
          const n =
            table === translated
              ? 3
              : childRowsOf(table, where.and ?? []).length;
          removed.set(table, (removed.get(table) ?? 0) + n);
          return n;
        }),
        // Raw SQL is not how a count is read: a count through it reads nothing.
        executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
        // The translations of the instances it reads, through Drizzle: three for the middle level's.
        getDrizzle: () => ({
          execute: async () => ({ rows: [{ n: 3 }] }),
        }),
        select: vi.fn(
          async (
            table: string,
            options?: { where?: { and?: Condition[] } }
          ) => {
            if (table === "dynamic_components") return [];
            const conditions = options?.where?.and ?? [];
            return isProbe(conditions) ? [] : childRowsOf(table, conditions);
          }
        ),
      };
      return { adapter, removed };
    };

    const counting = fake();
    const counted = await countEntityComponentTree({
      adapter: counting.adapter as never,
      parentTable: "dc_posts",
    });
    // Counting removes nothing.
    expect(counting.adapter.delete).not.toHaveBeenCalled();

    const tearing = fake();
    await teardownEntityComponentData({
      adapter: tearing.adapter as never,
      parentTable: "dc_posts",
    });
    expect(new Map(counted.map(({ table, rows }) => [table, rows]))).toEqual(
      tearing.removed
    );
    expect(tearing.removed).toEqual(
      new Map([
        ["comp_l1", 1],
        ["comp_l2", 1],
        [translated, 3],
        ["comp_l3", 1],
      ])
    );
  });
});

describe("the walk over rows that point back at themselves", () => {
  it("follows each instance once, so a cycle of rows ends", async () => {
    // `comp_x`'s instance is its own parent's child: reading under it finds it again.
    type Condition = { column: string; op?: string; value?: unknown };
    const reads: string[] = [];
    const adapter = {
      dialect: "postgresql" as const,
      listTables: vi.fn().mockResolvedValue(["comp_x"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(),
      executeQuery: vi.fn().mockResolvedValue([{ n: 0 }]),
      getDrizzle: vi.fn(),
      select: vi.fn(
        async (table: string, options?: { where?: { and?: Condition[] } }) => {
          const conditions = options?.where?.and ?? [];
          if (table !== "comp_x" || conditions.some(c => c.op === "IS NULL")) {
            return [];
          }
          const parent = conditions.find(c => c.column === "_parent_table");
          reads.push(String(parent?.value));
          return [{ id: "x1" }];
        }
      ),
    };
    const counted = await countEntityComponentTree({
      adapter: adapter as never,
      parentTable: "dc_posts",
    });
    // Read under the entity, then once under `x1`, where it is found again and not followed.
    expect(reads).toEqual(["dc_posts", "comp_x"]);
    expect(counted).toEqual([{ table: "comp_x", rows: 2 }]);
  });
});
