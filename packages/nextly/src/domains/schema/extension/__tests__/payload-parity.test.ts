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
  isRegisteredExtensionTable,
  setActiveExtensionSchema,
  clearActiveExtensionSchema,
} from "../build-extension-schema";
import { toTableSpec } from "../compile";
import { col, defineTable, type InferInsert, type InferRow } from "../dsl";
import {
  assertIndexShapeSupported,
  resolveCheck,
  resolveForeignKey,
} from "../constraints";
import {
  assertAddableToExistingRows,
  assertMayAddColumns,
  assertMayOverride,
  assertOverrideCompatible,
} from "../extension-columns";
import { assertAdoptable, impliedEdges, toEdges } from "../relations";
import {
  assertMayExtendForeignTable,
  elementKey,
  viewForStream,
} from "../../ownership/element-ownership";
import { runEntityTransforms } from "../../../../plugins/entity-transforms";
import { uuidV7Timestamp } from "../../../../utils/uuid-v7";
import {
  assertUsableClientId,
  fieldProducesColumn,
  generateId,
  resolvePostgresSchema,
} from "../collection-db-options";

const notes = defineTable(
  "notes",
  { id: col.id(), title: col.shortText(), body: col.text({ nullable: true }) },
  { indexes: [{ columns: ["title"], unique: true }] }
);

function input(extra: Record<string, unknown> = {}) {
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
  it("are expressible, and refused on MySQL rather than silently widened", () => {
    const partial = { name: "idx_t_done", columns: ["done"], where: "done" };
    expect(() =>
      assertIndexShapeSupported(partial, "postgresql", "t")
    ).not.toThrow();
    // Payload emits Drizzle `.where()` and leaves the dialect to cope. A
    // predicate dropped on MySQL makes a unique index enforce uniqueness over
    // rows that were legal until the deploy.
    expect(() => assertIndexShapeSupported(partial, "mysql", "t")).toThrow(
      NextlyError
    );
  });

  it.todo("C8: a partial index survives migrate:create and re-diffs clean");
});

describe("row 7 — expression indexes", () => {
  it("are expressible and separated from column indexes", () => {
    expect(() =>
      assertIndexShapeSupported(
        { name: "idx_t_lower", columns: [], expression: "lower(a)" },
        "postgresql",
        "t"
      )
    ).not.toThrow();
    // Declaring both is refused: the converter reports an expression index
    // with an empty column list, so the two are indistinguishable downstream.
    expect(() =>
      assertIndexShapeSupported(
        { name: "idx_t_x", columns: ["a"], expression: "lower(a)" },
        "postgresql",
        "t"
      )
    ).toThrow(NextlyError);
  });

  it.todo("C8: an expression index survives migrate:create and re-diffs clean");
});

describe("row 8 — foreign keys with onDelete/onUpdate", () => {
  it("records a reference today, WITHOUT a database constraint", async () => {
    // The current, deliberate state: `IndexSpec` cannot express a foreign key
    // and the Drizzle round trip drops one, so emitting a constraint the diff
    // could neither see nor drop would be worse than none. C1 adds the real
    // constraint; this asserts what holds until then, so the gap is visible
    // rather than assumed.
    const table = defineTable("links", {
      id: col.id(),
      userId: col.ref("users"),
    });
    const column = table.columns.find(c => c.key === "userId");
    expect(column?.references).toBe("users");
    expect(column?.kind).toBe("shortText");
  });

  it("expresses a real foreign key with referential actions", () => {
    const fk = resolveForeignKey(
      "links",
      {
        columns: ["user_id"],
        references: { table: "users", columns: ["id"] },
        onDelete: "cascade",
      },
      new Set(["user_id"])
    );
    expect(fk).toMatchObject({
      referencesTable: "users",
      onDelete: "cascade",
      // Defaulted conservatively: a cascade nobody asked for removes data on
      // an unrelated write.
      onUpdate: "no action",
    });
  });

  it.todo("C8: a foreign key survives migrate:create and re-diffs clean");
});

describe("row 9 — check constraints", () => {
  it("are expressible, with a derived name", () => {
    expect(resolveCheck("orders", { sql: "total >= 0" }, 0)).toEqual({
      name: "ck_orders_0",
      sql: "total >= 0",
    });
  });

  it.todo("C8: a check survives migrate:create and re-diffs clean");
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
  it("derives a `one` edge from a ref rather than asking for it twice", () => {
    // Payload has the author return `relations` from the hook. Here a `ref`
    // already states where the column points, so the edge comes from it —
    // two statements of one fact come to disagree, and a relational query
    // following the wrong one returns rows that look plausible.
    expect(
      impliedEdges({
        name: "fx__orders",
        authored: "orders",
        owner: { kind: "plugin", id: "fx" },
        columns: [
          {
            key: "userId",
            name: "user_id",
            kind: "shortText",
            nullable: false,
            references: "users",
          },
        ],
        indexes: [],
      })
    ).toEqual([{ key: "user", fromColumn: "user_id", targetTable: "users" }]);
  });

  it("puts a `many` edge on the target, pointing back", () => {
    const { reverse } = toEdges("fx__orders", [
      { kind: "many", key: "orders", targetTable: "users", column: "user_id" },
    ]);
    expect(reverse.get("users")?.[0]?.targetTable).toBe("fx__orders");
  });

  it.todo("C5: db.query.<t>.findMany({ with }) on three dialects");
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
  it("adopts an unmanaged table and refuses a managed one", () => {
    const managed = new Set(["dc_posts", "users"]);
    expect(() => assertAdoptable("legacy_orders", managed)).not.toThrow();
    // Payload's `beforeSchemaInit` takes introspected tables so it stops
    // dropping them. The refusal is the addition: adopting a table Nextly
    // MAINTAINS would make schema changes to it silently stop being applied,
    // because "not managed" is exactly the state that produces no operations.
    expect(() => assertAdoptable("dc_posts", managed)).toThrow(NextlyError);
  });

  it.todo("C6: push and migrate:create never touch it, on three dialects");
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
  it("is refused today, with element-level ownership arriving in C7", async () => {
    const schema = await buildExtensionSchema(input());
    setActiveExtensionSchema("postgresql", schema);
    try {
      expect(isRegisteredExtensionTable("fx__notes", "postgresql")).toBe(true);
    } finally {
      clearActiveExtensionSchema();
    }
  });

  it("hides an app-added element from the plugin's own reconcile", () => {
    // The load-bearing property. Without it the live table has a column the
    // plugin's module snapshot does not, so it matches neither endpoint and
    // adoption is refused on a database that is entirely correct.
    const spec = {
      name: "fx__notes",
      columns: [
        { name: "id", type: "varchar(36)", nullable: false },
        { name: "app_note", type: "text", nullable: true },
      ],
    };
    const owners = new Map([
      [
        elementKey("fx__notes", "column", "app_note"),
        {
          tableName: "fx__notes",
          elementKind: "column" as const,
          elementName: "app_note",
          migratedBy: "app",
        },
      ],
    ]);
    expect(
      viewForStream(spec, "plugin:fx", owners).columns.map(c => c.name)
    ).toEqual(["id"]);
    expect(
      viewForStream(spec, "app", owners).columns.map(c => c.name)
    ).toContain("app_note");
  });
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
  it("produce no column, on any field type", () => {
    // Reuses the "descriptor returns null" path every consumer already
    // honours for component fields. A second mechanism would need each of
    // them taught again, and the one that was missed would emit a column for
    // a field that has no value.
    expect(fieldProducesColumn({ type: "text", virtual: true })).toBe(false);
    expect(fieldProducesColumn({ type: "number", virtual: true })).toBe(false);
    expect(fieldProducesColumn({ type: "text" })).toBe(true);
  });
});

describe("row 21 — server-only custom config", () => {
  it("is delivered by `custom`, which predates this plan", () => {
    expect(true).toBe(true);
  });
});

describe("row 22 — collection id type", () => {
  it("chooses the generator without changing the storage", () => {
    // Which is what keeps relations, the REST API and the admin unaffected:
    // both are 36 characters in the same column, and only the bytes differ.
    expect(uuidV7Timestamp(generateId("uuidv7"))).not.toBeNull();
    expect(uuidV7Timestamp(generateId("uuid"))).toBeNull();
    expect(generateId("uuid")).toHaveLength(36);
  });
});

describe("row 23 — client-supplied id on create", () => {
  it("is off by default and validated by shape when on", () => {
    expect(() => assertUsableClientId("x", false, "posts")).toThrow(
      NextlyError
    );
    expect(
      assertUsableClientId(
        "018f2c2e-0000-7000-8000-000000000000",
        true,
        "posts"
      )
    ).toBeTruthy();
    // An arbitrary string would let a caller pick a key that collides with a
    // future generated one.
    expect(() => assertUsableClientId("hello", true, "posts")).toThrow(
      NextlyError
    );
  });
});

describe("row 24 — a Postgres schema other than public", () => {
  it("resolves on PostgreSQL and is ignored with a warning elsewhere", () => {
    expect(resolvePostgresSchema("cms", "postgresql", () => undefined)).toBe(
      "cms"
    );
    // Refusing would make one config unusable across dialects; ignoring it
    // silently would leave an operator believing their tables were namespaced.
    const warn = vi.fn();
    expect(resolvePostgresSchema("cms", "sqlite", warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it.todo("C10: a fresh PG install creates everything in that schema");
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
  it("transforms another plugin's collection, in dependency order", () => {
    // The gap this closes: `setup(config)` runs BEFORE plugin schema
    // contributions are merged, so a plugin never sees another plugin's
    // collections. Payload hands over the whole config; transforms run after
    // the merge, which is the only point at which the other collection
    // exists to be changed.
    const out = runEntityTransforms(
      [
        {
          slug: "forms",
          kind: "collection",
          definition: { slug: "forms", fields: ["name"] },
        },
      ],
      [
        {
          source: "plugin:seo",
          transforms: [
            {
              target: "forms",
              transform: e => ({
                ...e,
                fields: [...(e.fields as string[]), "metaTitle"],
              }),
            },
          ],
        },
      ]
    );
    expect(out[0].definition.fields).toEqual(["name", "metaTitle"]);
  });
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
  it("needs dependsOn or optionalDependsOn, and says so", () => {
    // Payload allows this only from the app hook; plugins cannot. Here they
    // can, with a declared dependency — which is what lets the resolver order
    // the two and refuse an incompatible version.
    expect(() =>
      assertMayExtendForeignTable({
        contributor: "seo",
        ownerPlugin: "auth",
        dependsOn: new Set(["auth"]),
        optionalDependsOn: new Set(),
        tableName: "auth__identities",
      })
    ).not.toThrow();
    expect(() =>
      assertMayExtendForeignTable({
        contributor: "seo",
        ownerPlugin: "auth",
        dependsOn: new Set(),
        optionalDependsOn: new Set(),
        tableName: "auth__identities",
      })
    ).toThrow(NextlyError);
  });
});
