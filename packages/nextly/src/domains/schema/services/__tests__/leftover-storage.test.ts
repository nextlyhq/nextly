/**
 * What a create does about tables already standing under its name: a family holding rows is
 * refused, naming each table and its rows; an empty one is dropped; a translations table left
 * without its main table is looked at too; and a table referencing the leftover is dropped only
 * when it is a junction this kind's create generates for it. Anything else referencing it belongs
 * to something else, and refuses the create. Every table is probed before any is dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const live = {
  tables: new Set<string>(),
  rows: new Map<string, number>(),
  referencing: [] as string[],
  columns: new Map<string, string[]>(),
  views: new Map<string, string[]>(),
  elsewhere: [] as { table: string; rows: number }[],
};

vi.mock("../../pipeline/live-table-facts", () => ({
  tableHasRows: vi.fn(
    async (_db: unknown, _dialect: unknown, table: string) =>
      (live.rows.get(table) ?? 0) > 0
  ),
  countTableRows: vi.fn(
    async (_db: unknown, _dialect: unknown, table: string) =>
      live.rows.get(table) ?? 0
  ),
  readReferencingTables: vi.fn(async () => live.referencing),
  readDependentViews: vi.fn(
    async (_db: unknown, _dialect: unknown, table: string) =>
      live.views.get(table) ?? []
  ),
}));

vi.mock("../../pipeline/diff/introspect-live", () => ({
  introspectLiveColumns: vi.fn(
    async (_db: unknown, _dialect: unknown, [table]: string[]) => ({
      tables: [
        {
          name: table,
          columns: (live.columns.get(table) ?? []).map(name => ({
            name,
            type: "text",
            nullable: true,
          })),
        },
      ],
    })
  ),
}));

const { clearLeftoverStorage } = await import("../leftover-storage");

const dropped: string[] = [];
const adapter = {
  tableExists: vi.fn(async (table: string) => live.tables.has(table)),
  getDrizzle: () => ({}),
  getCapabilities: () => ({ dialect: "postgresql" as const }),
  dropTable: vi.fn(async (table: string) => {
    dropped.push(table);
  }),
};

function clear(
  kind: "fieldGroup" | "single",
  tableName: string,
  plannedJunctions: string[] = []
) {
  return clearLeftoverStorage({
    adapter,
    kind,
    slug: "card",
    tableName,
    makesJunctionTables: kind === "single",
    plannedJunctions,
    ownedElsewhere: async () => live.elsewhere,
    logger: { info: () => {} },
    dropFamily: async () => {
      dropped.push(`family:${tableName}`);
    },
  });
}

beforeEach(() => {
  live.tables = new Set();
  live.rows = new Map();
  live.referencing = [];
  live.columns = new Map();
  live.views = new Map();
  live.elsewhere = [];
  dropped.length = 0;
});

describe("clearLeftoverStorage", () => {
  it("does nothing where no table of the family stands", async () => {
    await clear("fieldGroup", "comp_card");
    expect(dropped).toEqual([]);
  });

  it("refuses over a translations table holding rows whose main table is gone", async () => {
    live.tables = new Set(["comp_card_locales"]);
    live.rows.set("comp_card_locales", 3);

    await expect(clear("fieldGroup", "comp_card")).rejects.toMatchObject({
      publicMessage: expect.stringContaining('"comp_card_locales" (3 rows)'),
    });
    expect(dropped).toEqual([]);
  });

  it("drops an empty translations table whose main table is gone", async () => {
    live.tables = new Set(["comp_card_locales"]);

    await clear("fieldGroup", "comp_card");

    expect(dropped).toEqual(["family:comp_card"]);
  });

  it("refuses, dropping nothing, when another table references a field group's leftover", async () => {
    live.tables = new Set(["comp_card"]);
    live.referencing = ["comp_card_audit"];
    live.columns.set("comp_card_audit", ["id", "card_id"]);

    await expect(clear("fieldGroup", "comp_card")).rejects.toMatchObject({
      publicMessage: expect.stringContaining('"comp_card_audit" references'),
    });
    expect(dropped).toEqual([]);
  });

  it("drops a Single's empty junction table first, then its family", async () => {
    live.tables = new Set(["single_home"]);
    live.referencing = ["dc_posts_single_home_picks"];
    live.columns.set("dc_posts_single_home_picks", [
      "id",
      "single_home_id",
      "posts_id",
    ]);

    await clear("single", "single_home");

    expect(dropped).toEqual([
      "dc_posts_single_home_picks",
      "family:single_home",
    ]);
  });

  it("refuses a table named like a Single's junction that does not key the Single", async () => {
    live.tables = new Set(["single_home"]);
    live.referencing = ["single_home_notes"];
    live.columns.set("single_home_notes", ["id", "home"]);

    await expect(clear("single", "single_home")).rejects.toMatchObject({
      publicMessage: expect.stringContaining('"single_home_notes" references'),
    });
    expect(dropped).toEqual([]);
  });

  it("probes every table before dropping any", async () => {
    live.tables = new Set(["single_home"]);
    live.referencing = ["dc_posts_single_home_picks"];
    live.columns.set("dc_posts_single_home_picks", ["id", "single_home_id"]);
    live.rows.set("dc_posts_single_home_picks", 1);

    await expect(clear("single", "single_home")).rejects.toMatchObject({
      publicMessage: expect.stringContaining(
        '"dc_posts_single_home_picks" (1 row)'
      ),
    });
    expect(dropped).toEqual([]);
  });

  // PostgreSQL's CASCADE drops a main table's dependants' foreign keys, not the junction tables
  // themselves: one can stand with nothing referencing anything, where the create will build it.
  it("drops an empty junction the create will build when its main table is gone", async () => {
    live.tables = new Set(["dc_posts_single_home_picks"]);
    live.columns.set("dc_posts_single_home_picks", ["id", "single_home_id"]);

    await clear("single", "single_home", ["dc_posts_single_home_picks"]);

    expect(dropped).toEqual([
      "dc_posts_single_home_picks",
      "family:single_home",
    ]);
  });

  it("refuses over a junction the create will build that holds rows, its main table gone", async () => {
    live.tables = new Set(["dc_posts_single_home_picks"]);
    live.columns.set("dc_posts_single_home_picks", ["id", "single_home_id"]);
    live.rows.set("dc_posts_single_home_picks", 4);

    await expect(
      clear("single", "single_home", ["dc_posts_single_home_picks"])
    ).rejects.toMatchObject({
      publicMessage: expect.stringContaining(
        '"dc_posts_single_home_picks" (4 rows)'
      ),
    });
    expect(dropped).toEqual([]);
  });

  it("refuses, dropping nothing, when the leftover's rows live in tables outside its family", async () => {
    live.tables = new Set(["single_home"]);
    live.elsewhere = [{ table: "comp_chip", rows: 2 }];

    await expect(clear("single", "single_home")).rejects.toMatchObject({
      publicMessage: expect.stringContaining('"comp_chip" (2 rows)'),
    });
    expect(dropped).toEqual([]);
  });

  it("refuses an empty table standing where the create would build a junction it names itself", async () => {
    // `options.junctionTable` names it: nothing says it is this Single's.
    live.tables = new Set(["home_links"]);
    live.columns.set("home_links", ["id", "post_id"]);

    await expect(
      clear("single", "single_home", ["home_links"])
    ).rejects.toMatchObject({
      publicMessage: expect.stringContaining('"home_links" stands'),
    });
    expect(dropped).toEqual([]);
  });

  it("refuses, dropping nothing, when a view reads an empty leftover", async () => {
    live.tables = new Set(["comp_card"]);
    live.views.set("comp_card", ["card_report"]);

    await expect(clear("fieldGroup", "comp_card")).rejects.toMatchObject({
      publicMessage: expect.stringContaining('"card_report"'),
    });
    expect(dropped).toEqual([]);
  });
});
