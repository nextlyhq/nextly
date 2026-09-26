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
import { typesDiffer } from "../../pipeline/diff/declared-size";
import { normalizeDefault } from "../../pipeline/diff/normalize-default";
import { normalizeType } from "../../pipeline/diff/normalize-type";
import { renderedType } from "../../pipeline/sql-templates/create-table-body";
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
    const config = getTableConfig(built.drizzle["fx__linked"] as never);
    // drizzle rc.4 exposes the actions and arity, not the name, on the
    // config object; the name is carried by the builder into DDL.
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
  });

  // Outside the bundle used to mean "skipped": the resolver looked the table
  // up in a registry boot had not built yet, found nothing, and SQLite — which
  // takes a foreign key in CREATE TABLE or never — silently enforced nothing.
  it.each([
    ["a core table", "users", ["users"], []],
    ["an entity table", "dc_orders", [], [{ name: "dc_orders" }]],
  ])(
    "carries a foreign key to %s outside the bundle",
    async (_label, target, coreTableNames, entities) => {
      const { getTableName } = await import("drizzle-orm");
      const { getTableConfig } = await import("drizzle-orm/sqlite-core");
      const linked = defineTable(
        "linked",
        { id: col.id(), refId: col.shortText() },
        {
          foreignKeys: [
            {
              columns: ["refId"],
              references: { table: target, columns: ["id"] },
              onDelete: "cascade",
            },
          ],
        }
      );
      const built = await buildExtensionSchema({
        dialect: "sqlite" as const,
        coreTableNames,
        entities: entities.map(entity => ({
          ...entity,
          slug: "orders",
          entityKind: "collection" as const,
          columns: [],
        })),
        pluginPrefixes: new Map([["fx", "fx"]]),
        plugins: [
          { owner: { kind: "plugin" as const, id: "fx" }, tables: [linked] },
        ],
      });
      const config = getTableConfig(built.drizzle["fx__linked"] as never);
      expect(config.foreignKeys).toHaveLength(1);
      const reference = config.foreignKeys[0]!.reference();
      expect(getTableName(reference.foreignTable)).toBe(target);
      expect(reference.foreignColumns.map(column => column.name)).toEqual([
        "id",
      ]);
      expect(reference.columns.map(column => column.name)).toEqual(["ref_id"]);
      expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
    }
  );
});

describe("derived constraint names on long tables", () => {
  // A 59-character table and two 50-character columns sharing their first 46:
  // the composed names run past 100 characters. A plain truncation also fits
  // 63 characters and would give both columns the same constraint name, which
  // is why DISTINCTNESS is asserted beside the bound.
  const longTable = `fx__${"t".repeat(55)}`;
  const first = `${"c".repeat(46)}_one`;
  const second = `${"c".repeat(46)}_two`;
  const longSpec = (dialect: SupportedDialect) =>
    toTableSpec(
      {
        ...table,
        name: longTable,
        columns: [column(first, "shortText"), column(second, "shortText")],
        foreignKeys: [
          {
            columns: [first],
            referencesTable: "users",
            referencesColumns: ["id"],
            onDelete: "cascade",
            onUpdate: "no action",
          },
          {
            columns: [second],
            referencesTable: "users",
            referencesColumns: ["id"],
            onDelete: "cascade",
            onUpdate: "no action",
          },
        ],
        checks: [
          { name: `${first}_ok`, sql: `${first} <> ''` },
          { name: `${second}_ok`, sql: `${second} <> ''` },
        ],
      },
      dialect
    );

  it.each(DIALECTS)(
    "bounds and separates foreign key and check names on %s",
    dialect => {
      const spec = longSpec(dialect);
      const names = [
        ...(spec.foreignKeys ?? []).map(fk => fk.name),
        ...(spec.checks ?? []).map(ck => ck.name),
      ];
      expect(names).toHaveLength(4);
      for (const name of names) expect(name.length).toBeLessThanOrEqual(63);
      expect(new Set(names).size).toBe(4);
      // Deterministic, because live introspection has to find them again.
      expect(longSpec(dialect).foreignKeys?.map(fk => fk.name)).toEqual(
        spec.foreignKeys?.map(fk => fk.name)
      );
    }
  );

  it("leaves a short name exactly as it was", () => {
    const spec = toTableSpec(
      {
        ...table,
        columns: [column("owner_id", "shortText")],
        foreignKeys: [
          {
            columns: ["owner_id"],
            referencesTable: "users",
            referencesColumns: ["id"],
            onDelete: "cascade",
            onUpdate: "no action",
          },
        ],
        checks: [{ name: "owner_set", sql: "owner_id <> ''" }],
      },
      "postgresql"
    );
    expect(spec.foreignKeys?.[0]?.name).toBe("fk_auth__identities_owner_id");
    expect(spec.checks?.[0]?.name).toBe("ck_auth__identities_owner_set");
  });

  it("creates the SQLite foreign key under the name the spec compares", async () => {
    const { getTableConfig } = await import("drizzle-orm/sqlite-core");
    const long: ExtensionTable = {
      ...table,
      name: longTable,
      columns: [column(first, "shortText")],
      foreignKeys: [
        {
          columns: [first],
          referencesTable: "users",
          referencesColumns: ["id"],
          onDelete: "cascade",
          onUpdate: "no action",
        },
      ],
    };
    const { referenceTableStub } = await import("../compile");
    const drizzleTable = toDrizzleTable(long, "sqlite", referenceTableStub);
    const config = getTableConfig(drizzleTable as never);
    expect(config.foreignKeys[0]?.getName()).toBe(
      toTableSpec(long, "sqlite").foreignKeys?.[0]?.name
    );
    expect(config.foreignKeys[0]?.getName().length).toBeLessThanOrEqual(63);
  });
});

describe("check names that collide", () => {
  it("refuses a declared check and an enum check resolving to one name", () => {
    const clash: ExtensionTable = {
      ...table,
      columns: [column("state", "enum", { enumValues: ["a", "b"] })],
      checks: [{ name: "state_enum", sql: "state <> ''" }],
    };
    expect(() => toTableSpec(clash, "postgresql")).toThrow(NextlyError);
    // The control: the same table with the check named otherwise compiles.
    expect(() =>
      toTableSpec(
        { ...clash, checks: [{ name: "state_set", sql: "state <> ''" }] },
        "postgresql"
      )
    ).not.toThrow();
  });
});

describe("char width on PostgreSQL", () => {
  // PostgreSQL 17 reports a `char(2)` column as udt_name `bpchar` with
  // character_maximum_length 2, which introspection records as typeModifier.
  const live = {
    name: "code",
    type: "bpchar",
    typeModifier: "2",
    nullable: false,
  };
  const charTable = (length: number): ExtensionTable => ({
    ...table,
    columns: [column("code", "char", { length })],
  });

  it("carries the width where introspection reports it", () => {
    const spec = toTableSpec(charTable(2), "postgresql").columns[0];
    expect(spec).toMatchObject({ type: "bpchar", typeModifier: "2" });
    // What a migration writes: the bounded type, not an unbounded bpchar.
    expect(renderedType(spec)).toBe("bpchar(2)");
    expect(typesDiffer(live, spec)).toBe(false);
  });

  it("lets the diff see a width change", () => {
    expect(
      typesDiffer(live, toTableSpec(charTable(4), "postgresql").columns[0])
    ).toBe(true);
  });

  it("adds no second width where the type already states one", () => {
    const spec = toTableSpec(charTable(2), "mysql").columns[0];
    expect(spec.type).toBe("char(2)");
    expect(spec.typeModifier).toBeUndefined();
  });
});

describe("a string default on a column MySQL stores as TEXT", () => {
  const withDefault: ExtensionTable = {
    ...table,
    columns: [column("body", "longText", { default: "x" })],
  };

  it("is an expression default on MySQL, which refuses a literal there", () => {
    // MySQL 8.0.46: `text DEFAULT 'x'` fails with error 1101;
    // `DEFAULT (CONVERT(X'78' USING utf8mb4))` is accepted.
    expect(toTableSpec(withDefault, "mysql").columns[0].default).toBe(
      "(CONVERT(X'78' USING utf8mb4))"
    );
  });

  it("compares equal to what MySQL reports for it", () => {
    // information_schema reports the expression without its parentheses,
    // and introspection restores them.
    const declared = toTableSpec(withDefault, "mysql").columns[0];
    expect(normalizeDefault("(convert(0x78 using utf8mb4))", "text")).toBe(
      normalizeDefault(declared.default, declared.type)
    );
  });

  it("stays a plain literal on the dialects that accept one", () => {
    expect(toTableSpec(withDefault, "postgresql").columns[0].default).toBe(
      "'x'"
    );
    expect(toTableSpec(withDefault, "sqlite").columns[0].default).toBe("'x'");
  });

  it("leaves a varchar column's default a literal on MySQL", () => {
    // The control: only the TEXT family needs the expression form.
    const varchar: ExtensionTable = {
      ...table,
      columns: [column("label", "text", { default: "x" })],
    };
    expect(toTableSpec(varchar, "mysql").columns[0].default).toBe("'x'");
  });
});
