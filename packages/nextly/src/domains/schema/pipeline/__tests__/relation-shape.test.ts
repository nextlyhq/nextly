/**
 * A relation's storage shape, and the change the diff plans from the shape a column had to the
 * shape it has.
 *
 * One id and a list of ids convert into each other; a reference naming one of several collections
 * is made from neither, so a switch to or from it requires the column empty, guarded ahead of every
 * other operation. A migration snapshot records the shape on both sides; a live table gets the
 * previous shape from the registry's record of the field. The SQLite statements are run here on a
 * real database, twice, since an apply can stop part-way and run them again.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff/diff";
import type {
  ChangeColumnTypeOp,
  ColumnSpec,
  NextlySchemaSnapshot,
} from "../diff/types";
import { referenceConversionStatements } from "../reference-list-conversion";
import { relationSwitches } from "../companion-shape-switches";
import { registryRows } from "../recorded-fields";
import { withRecordedShapes } from "../recorded-shapes";
import type { DesiredSchema } from "../types";

const ID: ColumnSpec = { name: "id", type: "text", nullable: false };

/** A snapshot of `dc_posts` holding `author` as `column` describes it. */
function posts(column: Partial<ColumnSpec>): NextlySchemaSnapshot {
  return {
    tables: [
      {
        name: "dc_posts",
        columns: [
          ID,
          { name: "author", type: "text", nullable: true, ...column },
        ],
      },
    ],
  };
}

const typeChanges = (ops: ReturnType<typeof diffSnapshots>) =>
  ops.filter(
    (op): op is ChangeColumnTypeOp => op.type === "change_column_type"
  );

describe("the live side, given each recorded relation's shape", () => {
  const desired = (
    recorded: Record<string, unknown>,
    kind: "collections" | "components" = "collections"
  ): DesiredSchema => ({
    collections: {},
    singles: {},
    components: {},
    [kind]: {
      posts: {
        slug: "posts",
        tableName: "dc_posts",
        fields: [],
        recordedFields: [{ name: "author", ...recorded }],
      },
    },
  });

  it("states the shape the recorded field stored on its column", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ type: "relationship", relationTo: "authors" }, "one"],
      [{ type: "relationship", relationTo: "authors", hasMany: true }, "list"],
      [{ type: "relationship", relationTo: ["authors", "tags"] }, "targets"],
      [
        {
          type: "relationship",
          relationTo: ["authors", "tags"],
          hasMany: true,
        },
        "targetList",
      ],
    ];
    for (const [recorded, shape] of cases) {
      const live = withRecordedShapes(posts({}), desired(recorded));
      expect(live.tables[0]?.columns[1]?.referenceShape).toBe(shape);
    }
  });

  it("reads a field group's many-to-many as the list its row keeps", () => {
    const live = withRecordedShapes(
      posts({}),
      desired(
        {
          type: "relationship",
          options: { target: "tags", relationType: "manyToMany" },
        },
        "components"
      )
    );
    expect(live.tables[0]?.columns[1]?.referenceShape).toBe("list");
  });

  it("leaves the live side as it is without recorded fields", () => {
    const live = posts({});
    expect(
      withRecordedShapes(live, { collections: {}, singles: {}, components: {} })
    ).toBe(live);
  });
});

describe("the change planned from the shapes", () => {
  it("converts in place between one id and a list where the type is the same", () => {
    expect(
      typeChanges(
        diffSnapshots(
          posts({ referenceShape: "one" }),
          posts({ referenceShape: "list" })
        )
      )
    ).toMatchObject([
      { fromType: "text", toType: "text", conversion: "referenceList" },
    ]);
    expect(
      typeChanges(
        diffSnapshots(
          posts({ referenceShape: "list" }),
          posts({ referenceShape: "one" })
        )
      )
    ).toMatchObject([{ conversion: "referenceScalar" }]);
  });

  it("guards a switch to or from several collections ahead of every operation, then retypes plainly", () => {
    const ops = diffSnapshots(
      posts({ referenceShape: "one" }),
      posts({ type: "jsonb", referenceShape: "targets" })
    );
    expect(ops[0]).toMatchObject({
      type: "change_column_type",
      fromType: "text",
      toType: "text",
      conversion: "requireEmpty",
    });
    const retype = typeChanges(ops).slice(1);
    expect(retype).toMatchObject([{ fromType: "text", toType: "jsonb" }]);
    expect(retype[0]).not.toHaveProperty("conversion");
  });

  it("guards a switch between one reference to several collections and a list of them", () => {
    expect(
      typeChanges(
        diffSnapshots(
          posts({ type: "jsonb", referenceShape: "targets" }),
          posts({ type: "jsonb", referenceShape: "targetList" })
        )
      )
    ).toMatchObject([{ conversion: "requireEmpty" }]);
  });

  it("reads the type alone where a side states no shape, as a snapshot from before it was recorded", () => {
    expect(diffSnapshots(posts({}), posts({ referenceShape: "list" }))).toEqual(
      []
    );
    expect(
      typeChanges(
        diffSnapshots(
          posts({ type: "uuid" }),
          posts({
            type: "jsonb",
            holdsReferenceList: true,
            referenceShape: "list",
          })
        )
      )
    ).toMatchObject([{ conversion: "referenceList" }]);
  });
});

describe("the guard requiring a column empty, run on SQLite", () => {
  function guard(values: Array<string | null>): void {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE "dc_posts" ("n" integer, "author" text)`);
      const insert = db.prepare(`INSERT INTO "dc_posts" VALUES (?, ?)`);
      values.forEach((value, n) => insert.run(n, value));
      for (const statement of referenceConversionStatements(
        {
          type: "change_column_type",
          tableName: "dc_posts",
          columnName: "author",
          fromType: "text",
          toType: "text",
          conversion: "requireEmpty",
        },
        "sqlite"
      )) {
        db.exec(statement);
      }
    } finally {
      db.close();
    }
  }

  it("passes, and can run again, while no row holds a value", () => {
    expect(() => {
      guard([null, "", "[]", "null"]);
      guard([null]);
    }).not.toThrow();
  });

  it("refuses, naming the column, while a row holds one", () => {
    expect(() => guard([null, "3f2a"])).toThrow(/dc_posts\.author/);
  });
});

describe("the SQLite statements, run twice over every stored shape", () => {
  function convert(
    conversion: "referenceList" | "referenceScalar",
    values: Array<string | null>
  ): Array<string | null> {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE "dc_posts" ("n" integer, "author" text)`);
      const insert = db.prepare(`INSERT INTO "dc_posts" VALUES (?, ?)`);
      values.forEach((value, n) => insert.run(n, value));
      const statements = referenceConversionStatements(
        {
          type: "change_column_type",
          tableName: "dc_posts",
          columnName: "author",
          fromType: "text",
          toType: "text",
          conversion,
        },
        "sqlite"
      );
      for (const statement of statements) db.exec(statement);
      const once = db
        .prepare(`SELECT "author" FROM "dc_posts" ORDER BY "n"`)
        .pluck()
        .all() as Array<string | null>;
      for (const statement of statements) db.exec(statement);
      const twice = db
        .prepare(`SELECT "author" FROM "dc_posts" ORDER BY "n"`)
        .pluck()
        .all() as Array<string | null>;
      expect(twice).toEqual(once);
      return once;
    } finally {
      db.close();
    }
  }

  it("keeps each id as a one-item list, a list as it is, and no reference as none", () => {
    expect(
      convert("referenceList", [
        null,
        "",
        "3f2a",
        '"3f2a"',
        '["a"]',
        '["a","b"]',
        "[]",
        "5",
      ])
    ).toEqual([
      null,
      "[]",
      '["3f2a"]',
      '["3f2a"]',
      '["a"]',
      '["a","b"]',
      "[]",
      // An id that reads as a number stays a string, as PostgreSQL keeps it.
      '["5"]',
    ]);
  });

  it("unwraps a one-item list, empties an empty one, and unquotes a quoted id", () => {
    expect(
      convert("referenceScalar", [null, '["a"]', "[]", "3f2a", '"3f2a"'])
    ).toEqual([null, "a", null, "3f2a", "3f2a"]);
  });

  // A generated migration runs no count before its statements, so the file itself refuses a list
  // one reference cannot hold, before it rewrites any row, as PostgreSQL's and MySQL's do.
  it("refuses a longer list before rewriting any row, naming the column", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE "dc_posts" ("n" integer, "author" text)`);
      const insert = db.prepare(`INSERT INTO "dc_posts" VALUES (?, ?)`);
      ['["a"]', '["a","b"]'].forEach((value, n) => insert.run(n, value));
      const statements = referenceConversionStatements(
        {
          type: "change_column_type",
          tableName: "dc_posts",
          columnName: "author",
          fromType: "text",
          toType: "text",
          conversion: "referenceScalar",
        },
        "sqlite"
      );
      expect(() => {
        for (const statement of statements) db.exec(statement);
      }).toThrow(/dc_posts\.author/);
      expect(
        db.prepare(`SELECT "author" FROM "dc_posts" ORDER BY "n"`).pluck().all()
      ).toEqual(['["a"]', '["a","b"]']);
    } finally {
      db.close();
    }
  });
});

describe("a column becoming a list, planned from a table built from config", () => {
  // A table built from config tracks no foreign keys, so the diff alone would leave the old key in
  // place: PostgreSQL then refuses the retype, and MySQL would put it back over the list. And a
  // migration file runs its operations in the order planned, where MySQL refuses to retype an
  // indexed column. So the key and the index both go ahead of the conversion.
  const previous: NextlySchemaSnapshot = {
    tables: [
      {
        name: "dc_posts",
        columns: [
          { name: "id", type: "text", nullable: false },
          { name: "author", type: "varchar(36)", nullable: true },
        ],
        foreignKeys: [
          {
            name: "fk_dc_posts_author",
            columns: ["author"],
            referencesTable: "dc_authors",
            referencesColumns: ["id"],
            onDelete: "set null",
            onUpdate: "no action",
          },
        ],
        indexes: [
          { name: "idx_dc_posts_author", columns: ["author"], unique: false },
        ],
      },
    ],
  };
  const desired: NextlySchemaSnapshot = {
    tables: [
      {
        name: "dc_posts",
        columns: [
          { name: "id", type: "text", nullable: false },
          {
            name: "author",
            type: "json",
            nullable: true,
            holdsReferenceList: true,
          },
        ],
        indexes: [],
      },
    ],
  };

  it("drops the key, then the index, then converts the column", () => {
    const ops = diffSnapshots(previous, desired);
    expect(ops.map(op => op.type)).toEqual([
      "drop_foreign_key",
      "drop_index",
      "change_column_type",
    ]);
    expect(ops[0]).toMatchObject({
      foreignKey: { name: "fk_dc_posts_author" },
      beforeConversion: true,
    });
    expect(ops[2]).toMatchObject({ conversion: "referenceList" });
  });
});

describe("reading what each relation stored before a change", () => {
  const failing = () => Promise.reject(new Error("database busy"));

  it("refuses when the registry is there and cannot be read", async () => {
    await expect(
      registryRows(failing, {
        kind: "collections",
        tableExists: () => Promise.resolve(true),
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({ code: "RELATION_HISTORY_UNREADABLE" }),
        ],
      },
    });
  });

  it("reads none from a registry not created yet", async () => {
    await expect(
      registryRows(failing, {
        kind: "collections",
        tableExists: () => Promise.resolve(false),
      })
    ).resolves.toEqual([]);
  });
});

describe("a switch made while its field moves to or from the translations table", () => {
  const author = (hasMany: boolean) => ({
    name: "author",
    type: "relationship",
    relationTo: "authors",
    hasMany,
  });
  const withAuthor = posts({});
  const withoutAuthor: NextlySchemaSnapshot = {
    tables: [{ name: "dc_posts", columns: [ID] }],
  };

  it("is refused before anything runs, naming the field", async () => {
    await expect(
      relationSwitches({
        db: undefined,
        dialect: "sqlite",
        desired: {
          collections: {
            posts: {
              slug: "posts",
              tableName: "dc_posts",
              fields: [author(true)] as never,
              recordedFields: [author(false)] as never,
            },
          },
          singles: {},
          components: {},
        },
        live: withAuthor,
        desiredSnapshot: withoutAuthor,
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.author",
            code: "RELATIONSHIP_SWITCH_WITH_TRANSLATION",
          }),
        ],
      },
    });
  });

  it("plans nothing extra where the field stays where it is", async () => {
    await expect(
      relationSwitches({
        db: undefined,
        dialect: "sqlite",
        desired: {
          collections: {
            posts: {
              slug: "posts",
              tableName: "dc_posts",
              fields: [author(true)] as never,
              recordedFields: [author(false)] as never,
            },
          },
          singles: {},
          components: {},
        },
        live: withAuthor,
        desiredSnapshot: withAuthor,
      })
    ).resolves.toEqual({ ops: [], tables: [] });
  });
});
