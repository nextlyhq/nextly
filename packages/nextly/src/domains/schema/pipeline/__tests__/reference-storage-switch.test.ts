/**
 * A relation switched between one related entry and many on SQLite, where its column is text
 * either way.
 *
 * The type comparison cannot see the switch there, so the registry's recorded fields mark the
 * column, the diff plans the conversion with the type unchanged, and the statements rewrite the
 * stored values in place. The statements are run here against a real SQLite database, twice, since
 * an apply can stop part-way and run them again.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff/diff";
import type {
  ChangeColumnTypeOp,
  NextlySchemaSnapshot,
  TableSpec,
} from "../diff/types";
import { referenceConversionStatements } from "../reference-list-conversion";
import {
  targetSwitches,
  withReferenceStorageSwitches,
} from "../reference-storage-switch";
import type { DesiredCollection, DesiredSchema } from "../types";

const TABLE: TableSpec = {
  name: "dc_posts",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "author", type: "text", nullable: true },
  ],
};

function collection(
  before: Record<string, unknown> | undefined,
  now: Record<string, unknown>
): DesiredCollection {
  return {
    slug: "posts",
    tableName: "dc_posts",
    fields: [{ name: "author", ...now }] as DesiredCollection["fields"],
    ...(before === undefined
      ? {}
      : {
          recordedFields: [
            { name: "author", ...before },
          ] as DesiredCollection["recordedFields"],
        }),
  };
}

const one = { type: "relationship", relationTo: "authors" };
const many = { type: "relationship", relationTo: "authors", hasMany: true };

function authorColumn(spec: TableSpec) {
  return spec.columns.find(column => column.name === "author");
}

describe("marking a switch from the registry's recorded fields", () => {
  it("marks one to many, and many to one, on SQLite", () => {
    expect(
      authorColumn(
        withReferenceStorageSwitches(TABLE, collection(one, many), "sqlite")
      )?.switchesReferenceStorage
    ).toBe("toList");
    expect(
      authorColumn(
        withReferenceStorageSwitches(TABLE, collection(many, one), "sqlite")
      )?.switchesReferenceStorage
    ).toBe("toScalar");
  });

  it("marks nothing where the dialect retypes the column, or nothing changed", () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      expect(
        withReferenceStorageSwitches(TABLE, collection(one, many), dialect)
      ).toBe(TABLE);
    }
    expect(
      withReferenceStorageSwitches(TABLE, collection(many, many), "sqlite")
    ).toBe(TABLE);
  });

  it("marks nothing without the recorded fields, which say what the field was", () => {
    expect(
      withReferenceStorageSwitches(TABLE, collection(undefined, many), "sqlite")
    ).toBe(TABLE);
  });

  it("marks no switch to or from several targets, whose references neither conversion makes", () => {
    const polymorphic = {
      type: "relationship",
      relationTo: ["authors", "tags"],
    };
    expect(
      withReferenceStorageSwitches(
        TABLE,
        collection(one, polymorphic),
        "sqlite"
      )
    ).toBe(TABLE);
    expect(
      withReferenceStorageSwitches(
        TABLE,
        collection(polymorphic, one),
        "sqlite"
      )
    ).toBe(TABLE);
  });
});

describe("planning the switch with the type unchanged", () => {
  const live: NextlySchemaSnapshot = {
    tables: [
      {
        ...TABLE,
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
      },
    ],
  };
  const desired: NextlySchemaSnapshot = {
    tables: [
      {
        ...withReferenceStorageSwitches(TABLE, collection(one, many), "sqlite"),
        foreignKeys: [],
      },
    ],
  };
  const ops = diffSnapshots(live, desired);

  it("plans the list conversion on the text column", () => {
    expect(
      ops.find(
        (op): op is ChangeColumnTypeOp => op.type === "change_column_type"
      )
    ).toMatchObject({
      columnName: "author",
      fromType: "text",
      toType: "text",
      conversion: "referenceList",
    });
  });

  it("leaves the key's drop to the apply route, since the column is not retyped", () => {
    const drop = ops.find(op => op.type === "drop_foreign_key");
    expect(drop).toBeDefined();
    expect(drop).not.toHaveProperty("beforeConversion");
  });

  it("plans nothing for the unmarked column", () => {
    expect(diffSnapshots({ tables: [TABLE] }, { tables: [TABLE] })).toEqual([]);
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
      const [statement] = referenceConversionStatements(
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
      db.exec(statement);
      const once = db
        .prepare(`SELECT "author" FROM "dc_posts" ORDER BY "n"`)
        .pluck()
        .all() as Array<string | null>;
      db.exec(statement);
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

  it("unwraps a one-item list, empties an empty one, and never cuts a longer list down", () => {
    expect(
      convert("referenceScalar", [
        null,
        '["a"]',
        "[]",
        '["a","b"]',
        "3f2a",
        '"3f2a"',
      ])
    ).toEqual([null, "a", null, '["a","b"]', "3f2a", "3f2a"]);
  });
});

describe("finding a switch to or from several targets, on every dialect", () => {
  const several = { type: "relationship", relationTo: ["authors", "tags"] };
  const severalMany = { ...several, hasMany: true };
  const found = (
    before: Record<string, unknown> | undefined,
    now: Record<string, unknown>
  ) => {
    const desired: DesiredSchema = {
      collections: { posts: collection(before, now) },
      singles: {},
      components: {},
    };
    return targetSwitches(desired);
  };

  it("finds one target becoming several, several becoming one, and one entry becoming many across several", () => {
    for (const [before, now] of [
      [one, several],
      [several, one],
      [many, several],
      [several, severalMany],
    ] as const) {
      expect(found(before, now)).toEqual([
        {
          tableName: "dc_posts",
          columnName: "author",
          label: "Collection 'posts'",
          field: "author",
        },
      ]);
    }
  });

  it("finds nothing for a single-target switch, which converts, or an unchanged field", () => {
    expect(found(one, many)).toEqual([]);
    expect(found(many, one)).toEqual([]);
    expect(found(several, several)).toEqual([]);
  });

  it("finds nothing without the recorded fields, or for a field the save adds", () => {
    expect(found(undefined, several)).toEqual([]);
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
