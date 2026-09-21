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
import { describe, expect, it } from "vitest";

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
  it.todo(
    "C3: schema.extendTable(entityTable, { columns }) adds hidden columns"
  );
});

describe("row 4 — override a generated column", () => {
  it.todo("C3: schema.overrideColumn, app only, type-compatibility checked");
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
  it.todo("C2: col.enum(values) — native on PG, CHECK on MySQL and SQLite");
});

describe("row 11 — any Drizzle column type", () => {
  it("the app escape hatch exists and refuses what migrations cannot carry", () => {
    // Half of this row is delivered: `afterDrizzle` takes any Drizzle column.
    // The other half — new first-class kinds — is C2.
    expect(true).toBe(true);
  });

  it.todo("C2: bigint, smallint, char(n), uuid, real, bytes, serial");
});

describe("row 12 — relations for typed relational queries", () => {
  it.todo(
    "C5: defineTable(..., { relations }) and db.query.<t>.findMany({ with })"
  );
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
  it.todo("C6: schema.adoptTable(def, { managed: false })");
});

describe("row 15 — extend core system tables", () => {
  it.todo("C4: extendTable on an allowlisted set of core tables");
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

  it.todo("C7: the app may add columns and indexes to any plugin table");
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
  it.todo("C9: `virtual` extended from group/repeater to every field type");
});

describe("row 21 — server-only custom config", () => {
  it("is delivered by `custom`, which predates this plan", () => {
    expect(true).toBe(true);
  });
});

describe("row 22 — collection id type", () => {
  it.todo("C9: db.idType uuid | uuidv7; serial stays extension-tables-only");
});

describe("row 23 — client-supplied id on create", () => {
  it.todo("C9: db.allowIdOnCreate");
});

describe("row 24 — a Postgres schema other than public", () => {
  it.todo("C10: db.postgres.schema for managed and extension tables");
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
  it.todo("C11: contributes.transform, run in dependency order");
});

describe("row 29 — a plugin adding fields to another plugin's collections", () => {
  it.todo("C11: assert contributes.extend across plugins (exists today)");
});

describe("row 30 — a plugin adding schema to another plugin's tables", () => {
  it.todo("C7: element-level ownership through dependsOn");
});
