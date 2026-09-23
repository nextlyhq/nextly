/**
 * What an extension table compiles to.
 *
 * The two load-bearing tests are the PARITY ones: an extension column must
 * render the same dialect type a collection field of the same kind renders,
 * and the Drizzle table must round-trip back to the spec. If either drifts, a
 * plugin table is diffed against a live table it does not describe, and the
 * pipeline proposes changes forever.
 */
import type { Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildExtensionSchema } from "../build-extension-schema";
import { col, defineTable } from "../dsl";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { drizzleTableToTableSpec } from "../../../../schemas/_internal/drizzle-to-tablespec";
import { renderDialectType } from "../../services/field-column-descriptor";
import { normalizeType } from "../../pipeline/diff/normalize-type";
import {
  indexNameForColumn,
  indexNameForColumns,
  uniqueIndexNameForColumn,
} from "../../services/index-name";
import { toDrizzleTable, toTableSpec } from "../compile";
import type { ExtensionColumn, ExtensionTable } from "../types";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

const column = (
  name: string,
  kind: ExtensionColumn["kind"],
  extra: Partial<ExtensionColumn> = {}
): ExtensionColumn => ({
  key: name,
  name,
  kind,
  nullable: false,
  ...extra,
});

const EVERY_KIND: ExtensionColumn[] = [
  column("c_text", "text"),
  column("c_long", "longText"),
  column("c_short", "shortText"),
  column("c_varchar", "varchar", { length: 64 }),
  column("c_bool", "boolean"),
  column("c_int", "integer"),
  column("c_double", "double"),
  column("c_decimal", "decimal", { precision: 10, scale: 2 }),
  column("c_ts", "timestamp"),
  column("c_json", "json"),
];

const table: ExtensionTable = {
  name: "auth__identities",
  authored: "identities",
  owner: { kind: "plugin", id: "auth" },
  columns: EVERY_KIND,
  indexes: [],
};

describe("toTableSpec type parity", () => {
  it("renders the same dialect type a collection field of that kind renders", () => {
    // The DSL must not invent a second type rendering. Asked of the SAME
    // function the collection pipeline asks, so the two cannot diverge.
    for (const dialect of DIALECTS) {
      const spec = toTableSpec(table, dialect);
      for (const col of EVERY_KIND) {
        const expected = renderDialectType(col.kind, dialect, {
          ...(col.length !== undefined ? { length: col.length } : {}),
          ...(col.precision !== undefined ? { precision: col.precision } : {}),
          ...(col.scale !== undefined ? { scale: col.scale } : {}),
        });
        expect(spec.columns.find(c => c.name === col.name)?.type).toBe(
          expected
        );
      }
    }
  });
});

describe("Drizzle round trip", () => {
  it("agrees with the spec on every column, as the DIFF compares them", () => {
    // Normalized, because that is the comparison the pipeline actually makes:
    // `renderDialectType` emits PG's udt_name `bool` while Drizzle reports
    // `boolean`, and `TYPE_ALIASES` maps both to `bool`. Comparing raw
    // spellings would fail on a pair the diff considers identical.
    const shape = (c: { name: string; type: string; nullable: boolean }) => ({
      name: c.name,
      type: normalizeType(c.type),
      nullable: c.nullable,
    });
    for (const dialect of DIALECTS) {
      const fromSpec = toTableSpec(table, dialect).columns.map(shape);
      const fromDrizzle = drizzleTableToTableSpec(
        toDrizzleTable(table, dialect) as Table,
        dialect
      ).columns.map(shape);
      expect(fromDrizzle).toEqual(fromSpec);
    }
  });

  it("agrees on declared WIDTH, which normalization cannot check", () => {
    // `normalizeType` strips every `(...)` modifier, so the test above passes
    // whatever width each side chose. The width still has to match: the
    // Drizzle table is what drizzle-kit CREATEs, so a disagreement creates a
    // column narrower than the spec claims and silently truncates writes.
    const widthOf = (type: string): string | null => {
      const match = /\(([^)]*)\)/.exec(type);
      return match ? match[1].replace(/\s+/g, "") : null;
    };
    for (const dialect of DIALECTS) {
      const specColumns = toTableSpec(table, dialect).columns;
      const drizzleColumns = drizzleTableToTableSpec(
        toDrizzleTable(table, dialect) as Table,
        dialect
      ).columns;
      let compared = 0;
      for (const specColumn of specColumns) {
        // Only where the modifier IS a width. MySQL spells boolean
        // `tinyint(1)`, whose "(1)" is part of the type synonym rather than a
        // width, and Drizzle reports it without one — a difference
        // `normalizeType` already reconciles.
        const normalized = normalizeType(specColumn.type);
        if (normalized !== "varchar" && normalized !== "numeric") continue;

        const mirror = drizzleColumns.find(c => c.name === specColumn.name);
        const specWidth = widthOf(specColumn.type);
        const drizzleWidth = widthOf(mirror?.type ?? "");
        compared += 1;
        expect({ [specColumn.name]: drizzleWidth }).toEqual({
          [specColumn.name]: specWidth,
        });
      }
      // The population assertion: a dialect where nothing carried a width
      // would pass this loop having compared nothing at all.
      if (dialect !== "sqlite") {
        expect(compared).toBeGreaterThan(0);
      }
    }
  });

  it("carries no indexes on the Drizzle side, by design", () => {
    // `index-restore.ts` and `stripKitDropsOfDeclaredIndexes` both depend on
    // this: indexes live on the spec and `add_index` is replayed separately.
    // Declaring them here too would make drizzle-kit emit its own CREATE
    // INDEX, and MySQL has no IF NOT EXISTS, so the duplicate name aborts.
    const withIndex: ExtensionTable = {
      ...table,
      indexes: [{ columns: ["c_short"], unique: true }],
    };
    for (const dialect of DIALECTS) {
      expect(toTableSpec(withIndex, dialect).indexes).toHaveLength(1);
      const drizzle = drizzleTableToTableSpec(
        toDrizzleTable(withIndex, dialect) as Table,
        dialect
      );
      expect(drizzle.indexes ?? []).toHaveLength(0);
    }
  });
});

describe("index naming", () => {
  it("leaves single-column names exactly as they were", () => {
    expect(indexNameForColumns("t", ["a"], false)).toBe(
      indexNameForColumn("t", "a")
    );
    expect(indexNameForColumns("t", ["a"], true)).toBe(
      uniqueIndexNameForColumn("t", "a")
    );
  });

  it("gives (a,b) and (b,a) different names", () => {
    expect(indexNameForColumns("t", ["a", "b"], false)).not.toBe(
      indexNameForColumns("t", ["b", "a"], false)
    );
  });

  it("separates a compound index from a single column spelled the same way", () => {
    // `["a","b"]` joined is `a_b`, which is also a legal column name — so the
    // joined list alone cannot identify the index.
    expect(indexNameForColumns("t", ["a", "b"], false)).not.toBe(
      indexNameForColumns("t", ["a_b"], false)
    );
  });

  it("stays within the identifier limit", () => {
    const long = indexNameForColumns(
      "a_very_long_table_name_indeed",
      ["column_one_is_long", "column_two_is_also_long"],
      true
    );
    expect(long.length).toBeLessThanOrEqual(63);
  });
});

describe("defaults", () => {
  it("renders the now token as the dialect's current-timestamp expression", () => {
    const withNow: ExtensionTable = {
      ...table,
      columns: [
        column("created_at", "timestamp", { default: { token: "now" } }),
      ],
    };
    expect(toTableSpec(withNow, "postgresql").columns[0].default).toBe("now()");
    expect(toTableSpec(withNow, "mysql").columns[0].default).toBe(
      "CURRENT_TIMESTAMP"
    );
    expect(toTableSpec(withNow, "sqlite").columns[0].default).toBe(
      "(strftime('%s', 'now'))"
    );
  });

  it("quotes a literal string default rather than treating it as a token", () => {
    // The case the tagged token exists for.
    const withWord: ExtensionTable = {
      ...table,
      columns: [column("label", "text", { default: "now" })],
    };
    expect(toTableSpec(withWord, "postgresql").columns[0].default).toBe(
      "'now'"
    );
  });
});

describe("explicit index names", () => {
  it("refuses a name the diff engine would never reconcile", () => {
    // `diffIndexes` only drops or re-creates `idx_`/`uq_` names, so anything
    // else is created once and then invisible to drift forever.
    const bad: ExtensionTable = {
      ...table,
      indexes: [{ columns: ["c_short"], unique: false, name: "my_index" }],
    };
    expect(() => toTableSpec(bad, "postgresql")).toThrow(NextlyError);
  });

  it("accepts a correctly prefixed name", () => {
    const good: ExtensionTable = {
      ...table,
      indexes: [{ columns: ["c_short"], unique: false, name: "idx_custom" }],
    };
    expect(toTableSpec(good, "postgresql").indexes?.[0]?.name).toBe(
      "idx_custom"
    );
  });
});

describe("toDrizzleTable: checks on the sqlite kit table only", () => {
  const withCheck = defineTable(
    "checked",
    { id: col.id(), score: col.integer({ nullable: true }) },
    { checks: [{ name: "score_ok", sql: "score >= 0" }] }
  );

  it("carries checks in the sqlite table definition, named by the compile rule", async () => {
    const { getTableConfig } = await import("drizzle-orm/sqlite-core");
    const { toDrizzleTable } = await import("../compile");
    const built = await buildExtensionSchema({
      dialect: "sqlite" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [withCheck] },
      ],
    });
    const drizzleTable = toDrizzleTable(
      built.tables[0] as never,
      "sqlite" as const
    );
    const config = getTableConfig(drizzleTable as never);
    expect(config.checks.map(c => c.name)).toContain("ck_fx__checked_score_ok");
  });

  it("keeps checks OFF the postgres kit table, which applies them by statement", async () => {
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const { toDrizzleTable } = await import("../compile");
    const built = await buildExtensionSchema({
      dialect: "postgresql" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [withCheck] },
      ],
    });
    const drizzleTable = toDrizzleTable(
      built.tables[0] as never,
      "postgresql" as const
    );
    const config = getTableConfig(drizzleTable as never);
    expect(config.checks).toEqual([]);
  });
});

describe("kit-table foreign keys on sqlite (bundle pass two)", () => {
  it("carries a foreign key whose referenced table is in the same bundle", async () => {
    const { getTableConfig } = await import("drizzle-orm/sqlite-core");
    const notes = defineTable(
      "notes",
      { id: col.id() },
      { indexes: [{ columns: ["id"], unique: true }] }
    );
    const linked = defineTable(
      "linked",
      { id: col.id(), noteId: col.shortText() },
      {
        foreignKeys: [
          {
            columns: ["noteId"],
            references: { table: "fx__notes", columns: ["id"] },
            onDelete: "cascade",
          },
        ],
      }
    );
    const built = await buildExtensionSchema({
      dialect: "sqlite" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        {
          owner: { kind: "plugin" as const, id: "fx" },
          tables: [notes, linked],
        },
      ],
    });
    const config = getTableConfig(
      built.drizzle["fx__linked"] as never
    );
    // drizzle rc.4 exposes the actions and arity, not the name, on the
    // config object; the name is carried by the builder into DDL.
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
  });

  it("skips a foreign key whose referenced table is outside the bundle", async () => {
    const { getTableConfig } = await import("drizzle-orm/sqlite-core");
    const linked = defineTable(
      "linked",
      { id: col.id(), userId: col.shortText() },
      {
        foreignKeys: [
          {
            columns: ["userId"],
            references: { table: "users", columns: ["id"] },
          },
        ],
      }
    );
    const built = await buildExtensionSchema({
      dialect: "sqlite" as const,
      coreTableNames: ["users"],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        { owner: { kind: "plugin" as const, id: "fx" }, tables: [linked] },
      ],
    });
    const config = getTableConfig(
      built.drizzle["fx__linked"] as never
    );
    expect(config.foreignKeys).toEqual([]);
  });
});
