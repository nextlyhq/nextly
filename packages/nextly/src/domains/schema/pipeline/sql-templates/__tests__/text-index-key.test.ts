/**
 * The key a plain index on a MySQL TEXT column is created by, on the roads that create one from an
 * `add_index` operation alone: a migration file, and the dev push replaying the indexes drizzle-kit
 * never creates.
 *
 * MySQL refuses a plain index on any TEXT or BLOB size without a key length (error 1170), so the
 * key is the column's first 191 characters, the shared rule a created table's indexes already
 * follow. The operation names only columns, so each road reads the column's type from the table
 * the statements lead to. A unique index keeps the whole key, since a prefix would constrain the
 * data, and PostgreSQL and SQLite index the whole value of every column.
 */
import { describe, expect, it } from "vitest";

import type {
  AddIndexOp,
  NextlySchemaSnapshot,
  TableSpec,
} from "../../diff/types";
import { indexRestoreStatements } from "../../index-restore";
import { generateStatements } from "../index";

const TABLE = "dc_notes";

/** A table holding one column of each type the rule separates. */
const table: TableSpec = {
  name: TABLE,
  columns: [
    { name: "id", type: "varchar(36)", nullable: false },
    { name: "body", type: "text", nullable: true },
    { name: "summary", type: "mediumtext", nullable: true },
    { name: "archive", type: "longtext", nullable: true },
    { name: "caption", type: "tinytext", nullable: true },
    { name: "attachment", type: "blob", nullable: true },
    { name: "thumbnail", type: "tinyblob", nullable: true },
    { name: "scan", type: "mediumblob", nullable: true },
    { name: "raw", type: "longblob", nullable: true },
    { name: "title", type: "varchar(255)", nullable: true },
  ],
};

/**
 * Another table whose `body` is a VARCHAR: each index reads the columns of its own table, so a
 * `body` index here is keyed whole.
 */
const other: TableSpec = {
  name: "dc_others",
  columns: [
    { name: "id", type: "varchar(36)", nullable: false },
    { name: "body", type: "varchar(100)", nullable: true },
  ],
};

const addIndex = (
  columns: string | string[],
  { unique = false, tableName = TABLE } = {}
): AddIndexOp => {
  const list = typeof columns === "string" ? [columns] : columns;
  return {
    type: "add_index",
    tableName,
    index: {
      name: `${unique ? "uq" : "idx"}_${tableName}_${list.join("_")}`,
      columns: list,
      unique,
    },
  };
};

/** The statement each road writes for one `add_index`, on one dialect. */
const ROADS = {
  "a migration file": (
    op: AddIndexOp,
    dialect: "mysql" | "postgresql" | "sqlite"
  ) => generateStatements([op], dialect, [table, other]),
  "the dev push's index replay": (
    op: AddIndexOp,
    dialect: "mysql" | "postgresql" | "sqlite"
  ) => {
    const desired: NextlySchemaSnapshot = {
      tables: [table, other].map(spec =>
        spec.name === op.tableName ? { ...spec, indexes: [op.index] } : spec
      ),
    };
    return indexRestoreStatements(desired, dialect, [], [op]);
  },
};

describe.each(Object.entries(ROADS))("%s", (_road, render) => {
  it("keys a column by its own table's type, not another table's", () => {
    expect(
      render(addIndex("body", { tableName: "dc_others" }), "mysql")
    ).toEqual(["CREATE INDEX `idx_dc_others_body` ON `dc_others` (`body`)"]);
  });

  it("keys each column of a several-column index by its own type", () => {
    expect(render(addIndex(["body", "title"]), "mysql")).toEqual([
      `CREATE INDEX \`idx_${TABLE}_body_title\` ON \`${TABLE}\` (\`body\`(191), \`title\`)`,
    ]);
  });

  it.each([
    "body",
    "summary",
    "archive",
    "caption",
    "attachment",
    "thumbnail",
    "scan",
    "raw",
  ])("keys a MySQL %s column by its first 191 characters", column => {
    expect(render(addIndex(column), "mysql")).toEqual([
      `CREATE INDEX \`idx_${TABLE}_${column}\` ON \`${TABLE}\` (\`${column}\`(191))`,
    ]);
  });

  it("keys a MySQL varchar column whole", () => {
    expect(render(addIndex("title"), "mysql")).toEqual([
      `CREATE INDEX \`idx_${TABLE}_title\` ON \`${TABLE}\` (\`title\`)`,
    ]);
  });

  it("keeps a unique index on a MySQL text column whole", () => {
    expect(render(addIndex("body", { unique: true }), "mysql")).toEqual([
      `CREATE UNIQUE INDEX \`uq_${TABLE}_body\` ON \`${TABLE}\` (\`body\`)`,
    ]);
  });

  it.each(["postgresql", "sqlite"] as const)(
    "keys a text column whole on %s",
    dialect => {
      expect(render(addIndex("body"), dialect)).toEqual([
        `CREATE INDEX IF NOT EXISTS "idx_${TABLE}_body" ON "${TABLE}" ("body")`,
      ]);
    }
  );
});
