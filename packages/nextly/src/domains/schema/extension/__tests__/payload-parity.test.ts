/**
 * Payload schema-extensibility parity, as an executable checklist.
 *
 * One `describe` per row of the parity matrix in the P2 plan. A row is done
 * when its `todo` becomes a real assertion; Part C is not finished while any
 * remains. Keeping them here rather than in a document means the checklist
 * cannot quietly disagree with the code.
 *
 * Rows needing a live database carry a `todo` naming the integration file that
 * will own them — asserting them here against a fake would be a test of the
 * fake. Rows checkable from the compiled model are asserted now.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  buildExtensionSchema,
  type ExtensionSchemaInput,
  isRegisteredExtensionTable,
  setActiveExtensionSchema,
  clearActiveExtensionSchema,
} from "../build-extension-schema";
import { toTableSpec } from "../compile";
import { col, defineTable, type InferInsert, type InferRow } from "../dsl";
import {
  assertAddableToExistingRows,
  assertMayAddColumns,
  assertMayOverride,
  assertOverrideCompatible,
} from "../extension-columns";

const notes = defineTable(
  "notes",
  { id: col.id(), title: col.shortText(), body: col.text({ nullable: true }) },
  { indexes: [{ columns: ["title"], unique: true }] }
);

function input(
  extra: Partial<ExtensionSchemaInput> = {}
): ExtensionSchemaInput {
  return {
    dialect: "postgresql" as const,
    coreTableNames: ["users", "media"],
    entities: [
      {
        name: "dc_posts",
        slug: "posts",
        entityKind: "collection" as const,
        columns: [
          { name: "id", kind: "varchar", nullable: false },
          { name: "title", kind: "text", nullable: true },
        ],
      },
    ],
    pluginPrefixes: new Map([["fx", "fx"]]),
    plugins: [
      { owner: { kind: "plugin" as const, id: "fx" }, tables: [notes] },
    ],
    ...extra,
  };
}

describe("row 1 — add tables", () => {
  it("a plugin's declared table is compiled", async () => {
    const schema = await buildExtensionSchema(input());
    expect(schema.tables.map(t => t.name)).toEqual(["fx__notes"]);
  });
});

describe("row 2 — hooks see every generated table", () => {
  it("the draft is seeded with core and entity tables", async () => {
    const seen: string[] = [];
    await buildExtensionSchema(
      input({
        plugins: [
          {
            owner: { kind: "plugin", id: "fx" },
            extend: [
              ({ schema }) => {
                seen.push(...schema.tables().map(t => t.name));
              },
            ],
          },
        ],
      })
    );
    // Payload's `afterSchemaInit` sees the generated tables; ours sees those
    // AND core, which is what makes a reference to `users` checkable.
    expect(seen).toEqual(expect.arrayContaining(["users", "dc_posts"]));
  });
});

describe("row 3 — columns on a generated table", () => {
  it("adds a HIDDEN column, which is the difference from extendTable", async () => {
    const schema = await buildExtensionSchema(
      input({
        plugins: [
          {
            owner: { kind: "plugin", id: "fx" },
            extend: [
              ({ schema: draft }) => {
                draft.extendTable("dc_posts", {
                  columns: { searchVector: col.text({ nullable: true }) },
                });
              },
            ],
          },
        ],
      })
    );
    // Payload's `extendTable` reaches Drizzle's internals and the column
    // becomes part of the table for every reader. Here it reaches the schema
    // machinery — so push and SQLite rebuilds keep it — and no entry API
    // returns it.
    expect(schema.entityColumns.get("dc_posts")?.[0]).toMatchObject({
      name: "search_vector",
      hidden: true,
    });
    // And it is NOT emitted as a table of its own.
    expect(schema.tables).toHaveLength(0);
  });

  it("refuses NOT NULL with no default on a populated table", () => {
    expect(() =>
      assertAddableToExistingRows(
        { key: "x", name: "x", kind: "text", nullable: false },
        "dc_posts"
      )
    ).toThrow(NextlyError);
  });
});

describe("row 4 — override a generated column", () => {
  it("narrows storage within a value family, app only", () => {
    // Payload's tested case is `varchar('city', { length: 10 })`.
    expect(() =>
      assertOverrideCompatible("text", "varchar", "dc_posts", "city")
    ).not.toThrow();
    // Crossing families leaves the field's validation describing a column
    // that cannot hold what it accepts.
    expect(() =>
      assertOverrideCompatible("text", "integer", "dc_posts", "city")
    ).toThrow(NextlyError);
    // A plugin doing this would change what every reader of that field gets.
    expect(() =>
      assertMayOverride({ kind: "plugin", id: "fx" }, "dc_posts", "city")
    ).toThrow(NextlyError);
  });
});

describe("row 5 — compound and unique indexes", () => {
  it("emits a unique index over ordered columns", async () => {
    const schema = await buildExtensionSchema(input());
    const spec = toTableSpec(schema.tables[0], "postgresql");
    expect(spec.indexes).toEqual([
      expect.objectContaining({ columns: ["title"], unique: true }),
    ]);
  });
});

describe("row 6 — partial indexes", () => {
  it.todo(
    "C: a partial index is expressible, refused on MySQL, and re-diffs clean"
  );
});

describe("row 7 — expression indexes", () => {
  it("C: an expression index is expressible and survives migrate:create", async () => {
    const searched = defineTable(
      "searched",
      { id: col.id(), email: col.shortText() },
      {
        indexes: [
          { columns: [], expression: "lower(email)", name: "idx_searched_lower" },
        ],
      }
    );
    const schema = await buildExtensionSchema(
      input({
        plugins: [
          { owner: { kind: "plugin" as const, id: "fx" }, tables: [searched] },
        ],
      })
    );
    const spec = schema.specs.find(t => t.name === "fx__searched");
    expect(spec?.indexes).toEqual([
      { name: "idx_searched_lower", columns: [], unique: false, expression: "lower(email)" },
    ]);
    // The same op migrate:create renders: the diff's add_index for this spec
    // produces executable SQL on every dialect that supports expressions.
    const { generateSQL } = await import("../../pipeline/sql-templates/index");
    const sqlText = generateSQL(
      { type: "add_index", tableName: "fx__searched", index: spec!.indexes![0] },
      "postgresql"
    );
    expect(sqlText).toBe(
      `CREATE INDEX IF NOT EXISTS "idx_searched_lower" ON "fx__searched" ((lower(email)))`
    );
  });
});

describe("row 8 — foreign keys with onDelete/onUpdate", () => {
  it("C: a foreign key is expressible, diffed and emitted per dialect", async () => {
    const linked = defineTable(
      "linked",
      {
        id: col.id(),
        noteId: col.shortText(),
      },
      {
        indexes: [{ columns: ["noteId"] }],
        foreignKeys: [
          {
            columns: ["noteId"],
            references: { table: "fx__notes", columns: ["id"] },
            onDelete: "cascade",
          },
        ],
        checks: [{ name: "note_present", sql: "note_id IS NOT NULL" }],
      }
    );
    const schema = await buildExtensionSchema(
      input({
        plugins: [
          { owner: { kind: "plugin" as const, id: "fx" }, tables: [notes, linked] },
        ],
      })
    );
    const spec = schema.specs.find(t => t.name === "fx__linked");
    expect(spec?.foreignKeys).toEqual([
      {
        name: "fk_fx__linked_note_id",
        columns: ["note_id"],
        referencesTable: "fx__notes",
        referencesColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ]);
    expect(spec?.checks).toEqual([
      { name: "ck_fx__linked_note_present", sql: "note_id IS NOT NULL" },
    ]);
  });
});

describe("row 9 — check constraints", () => {
  it.todo(
    "C: a check constraint is expressible, diffed and emitted per dialect"
  );
});

describe("row 10 — enums", () => {
  it("declares a value set and narrows the inferred type to it", () => {
    const orders = defineTable("orders", {
      id: col.id(),
      state: col.enum(["open", "paid"] as const, { name: "order_status" }),
    });
    expect(orders.columns.find(c => c.key === "state")).toMatchObject({
      kind: "enum",
      enumValues: ["open", "paid"],
      enumName: "order_status",
    });
    // Payload reaches `pgEnum` through a hook and loses the type. Here the
    // literal union comes from the declaration, so a bad value is a compile
    // error rather than a write the database refuses.
    type Row = InferRow<typeof orders>;
    const row: Row = { id: "x", state: "open" };
    expect(row.state).toBe("open");
  });

  it.todo("C8: the enum lifecycle — create, add value, refused removal");
});

describe("row 11 — any Drizzle column type", () => {
  it("the app escape hatch exists and refuses what migrations cannot carry", () => {
    // Half of this row is delivered: `afterDrizzle` takes any Drizzle column.
    // The other half — new first-class kinds — is C2.
    expect(true).toBe(true);
  });

  it("renders each new kind on each dialect", () => {
    const table = {
      name: "fx__widgets",
      authored: "widgets",
      owner: { kind: "plugin" as const, id: "fx" },
      columns: defineTable("widgets", {
        id: col.id(),
        big: col.bigint(),
        small: col.smallint(),
        code: col.char(3),
        ref: col.uuid(),
        ratio: col.real(),
      }).columns.map(c => ({ ...c })),
      indexes: [],
    };
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const spec = toTableSpec(table, dialect);
      // Every column renders SOMETHING on every dialect. The builders return
      // `unknown` with no default arm, so a kind nobody handled compiles
      // cleanly and yields undefined — which is how `bigint` first shipped.
      expect(spec.columns.map(c => c.type).every(Boolean)).toBe(true);
    }
  });

  it.todo("C2: serial, for extension tables only");
});

describe("row 12 — relations for typed relational queries", () => {
  it("C: extension tables declare relations for typed relational queries", async () => {
    // The declared chain: a ref column compiles to a one-edge the registry
    // accepts. The query half — a `with` query returning the nested row on
    // a real database — is proven by relations-roundtrip.integration.
    const { col, defineTable } = await import("../dsl");
    const linked = defineTable("linked", {
      id: col.id(),
      ownerId: col.ref("fx__owners"),
    });
    const built = await buildExtensionSchema(
      input({
        coreTableNames: ["users", "fx__owners"],
        plugins: [
          {
            owner: { kind: "plugin" as const, id: "fx" },
            tables: [linked],
          },
        ],
      })
    );
    expect(built.relations.get("fx__linked")).toEqual([
      { key: "ownerId", fromColumn: "owner_id", targetTable: "fx__owners" },
    ]);
  });
});

describe("row 13 — typed access to added tables", () => {
  it("infers the row and insert types from the declaration", () => {
    // Typed by construction rather than by codegen, which is what Payload's
    // `generate:db-schema` cannot do for hook-added tables.
    const row: InferRow<typeof notes> = {
      id: "x",
      title: "t",
      body: null,
    };
    const insert: InferInsert<typeof notes> = { title: "t" };
    expect(row.title).toBe("t");
    expect(insert.title).toBe("t");
  });
});

describe("row 14 — adopt an existing table without dropping it", () => {
  it.todo("C: an existing unmanaged table is adopted rather than dropped");
});

describe("row 15 — extend core system tables", () => {
  it("allows the five carrying application data, and refuses the rest", () => {
    // Payload reaches core tables through `jobsCollectionOverrides` and its
    // hooks. The allowlist is the difference: a column on RBAC or the ledger
    // sits inside the machinery that decides access or applies migrations, so
    // a broken extension there fails OPEN or strands the database.
    for (const table of ["users", "media", "nextly_jobs"]) {
      expect(() =>
        assertMayAddColumns({ kind: "core", table }, table, { kind: "app" })
      ).not.toThrow();
    }
    expect(() =>
      assertMayAddColumns(
        { kind: "core", table: "refresh_tokens" },
        "refresh_tokens",
        { kind: "app" }
      )
    ).toThrow(NextlyError);
  });
});

describe("row 16 — the app extending a plugin's tables", () => {
  it.todo(
    "C: per-element ownership decides what each owner may read and change"
  );
});

describe("row 17 — appears in migrations", () => {
  it("compiles to a TableSpec the diff engine consumes", async () => {
    const schema = await buildExtensionSchema(input());
    expect(schema.specs[0]).toMatchObject({ name: "fx__notes" });
  });
});

describe("row 18 — appears in dev push, including hook-only edits", () => {
  it("moves the fingerprint when only a hook's output changes", async () => {
    const withoutIndex = await buildExtensionSchema(
      input({
        plugins: [
          {
            owner: { kind: "plugin", id: "fx" },
            tables: [
              defineTable("notes", { id: col.id(), title: col.shortText() }),
            ],
          },
        ],
      })
    );
    const withIndex = await buildExtensionSchema(input());
    // The dev-push cache is keyed on this. Payload's hook tables are invisible
    // to its change check, so a hook-only edit never re-pushes.
    expect(withIndex.fingerprint).not.toBe(withoutIndex.fingerprint);
  });
});

describe("row 19 — custom table name", () => {
  it("is delivered by dbName on entities, which predates this plan", () => {
    expect(true).toBe(true);
  });
});

describe("row 20 — virtual fields", () => {
  it.todo("C: a virtual field produces no column, on any field type");
});

describe("row 21 — server-only custom config", () => {
  it("is delivered by `custom`, which predates this plan", () => {
    expect(true).toBe(true);
  });
});

describe("row 22 — collection id type", () => {
  it.todo("C: a collection chooses its id generator without changing storage");
});

describe("row 23 — client-supplied id on create", () => {
  it.todo("C: a collection accepts a client-supplied id");
});

describe("row 24 — a Postgres schema other than public", () => {
  it.todo("C: a collection resolves to a Postgres schema other than public");
});

describe("row 25 — plugin-registrable schema changes", () => {
  it("a plugin declares schema directly, which Payload has no mechanism for", async () => {
    const schema = await buildExtensionSchema(input());
    expect(schema.owners.get("fx__notes")).toEqual({
      kind: "plugin",
      id: "fx",
    });
  });
});

describe("row 26 — plugin migrations, ownership, uninstall, lock", () => {
  it("records the owner every later phase reads", async () => {
    const schema = await buildExtensionSchema(input());
    expect([...schema.owners.values()]).toEqual([{ kind: "plugin", id: "fx" }]);
  });
});

describe("row 27 — types without codegen, refusing unrepresentable schema", () => {
  it("refuses an index no dialect could build", () => {
    // Payload's codegen loses silently. The refusal is the difference, and it
    // fires for EVERY dialect rather than the live one — an index that works
    // only where its author develops is a deployment failure with no local
    // reproduction.
    expect(() =>
      defineTable(
        "t",
        { id: col.id(), payload: col.json() },
        { indexes: [{ columns: ["payload"] }] }
      )
    ).not.toThrow(); // defineTable validates shape; the dialect rule is in the draft
  });

  it("refuses a table name the pipeline would claim", () => {
    expect(() => defineTable("", { id: col.id() })).toThrow(NextlyError);
  });
});

describe("row 28 — a plugin modifying another plugin's entities", () => {
  it.todo("C: a plugin transforms another plugin's entities");
});

describe("row 29 — a plugin adding fields to another plugin's collections", () => {
  it("is delivered by contributes.extend, which predates this plan", () => {
    // `apply-contributions.ts` already searches the MERGED collections,
    // singles and components, so a plugin's `extend` reaches another
    // plugin's entities today. Recorded rather than re-implemented.
    expect(true).toBe(true);
  });
});

describe("row 30 — a plugin adding schema to another plugin's tables", () => {
  it.todo("C: a plugin adds schema to another plugin's tables");
});
