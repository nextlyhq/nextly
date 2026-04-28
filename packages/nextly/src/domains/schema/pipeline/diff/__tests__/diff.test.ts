import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff.js";
import type { NextlySchemaSnapshot } from "../types.js";

const empty: NextlySchemaSnapshot = { tables: [] };

function snap(
  ...tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      default?: string;
    }>;
  }>
): NextlySchemaSnapshot {
  return { tables };
}

describe("diffSnapshots - empty inputs", () => {
  it("empty -> empty yields no operations", () => {
    expect(diffSnapshots(empty, empty)).toEqual([]);
  });

  it("empty prev + table in cur yields add_table", () => {
    const cur = snap({
      name: "dc_posts",
      columns: [{ name: "id", type: "int4", nullable: false }],
    });
    const ops = diffSnapshots(empty, cur);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      type: "add_table",
      table: cur.tables[0],
    });
  });

  it("table in prev + empty cur yields drop_table", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [{ name: "id", type: "int4", nullable: false }],
    });
    const ops = diffSnapshots(prev, empty);
    expect(ops).toEqual([{ type: "drop_table", tableName: "dc_posts" }]);
  });
});

describe("diffSnapshots - column-level diff within existing table", () => {
  it("identical snapshot yields no operations", () => {
    const s = snap({
      name: "dc_posts",
      columns: [
        { name: "id", type: "int4", nullable: false },
        { name: "title", type: "text", nullable: true },
      ],
    });
    expect(diffSnapshots(s, s)).toEqual([]);
  });

  it("adding a column yields add_column", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [{ name: "id", type: "int4", nullable: false }],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [
        { name: "id", type: "int4", nullable: false },
        { name: "title", type: "text", nullable: true },
      ],
    });
    const ops = diffSnapshots(prev, cur);
    expect(ops).toEqual([
      {
        type: "add_column",
        tableName: "dc_posts",
        column: { name: "title", type: "text", nullable: true },
      },
    ]);
  });

  it("removing a column yields drop_column with previous type captured", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [
        { name: "id", type: "int4", nullable: false },
        { name: "title", type: "text", nullable: true },
      ],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [{ name: "id", type: "int4", nullable: false }],
    });
    const ops = diffSnapshots(prev, cur);
    expect(ops).toEqual([
      {
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "title",
        columnType: "text",
      },
    ]);
  });

  it("changing column type yields change_column_type", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [{ name: "title", type: "varchar", nullable: false }],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [{ name: "title", type: "text", nullable: false }],
    });
    const ops = diffSnapshots(prev, cur);
    expect(ops).toEqual([
      {
        type: "change_column_type",
        tableName: "dc_posts",
        columnName: "title",
        fromType: "varchar",
        toType: "text",
      },
    ]);
  });

  it("changing column nullable yields change_column_nullable", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [{ name: "title", type: "text", nullable: true }],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [{ name: "title", type: "text", nullable: false }],
    });
    const ops = diffSnapshots(prev, cur);
    expect(ops).toEqual([
      {
        type: "change_column_nullable",
        tableName: "dc_posts",
        columnName: "title",
        fromNullable: true,
        toNullable: false,
      },
    ]);
  });

  it("changing column default yields change_column_default", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [{ name: "status", type: "text", nullable: false }],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [
        { name: "status", type: "text", nullable: false, default: "'draft'" },
      ],
    });
    const ops = diffSnapshots(prev, cur);
    expect(ops).toEqual([
      {
        type: "change_column_default",
        tableName: "dc_posts",
        columnName: "status",
        fromDefault: undefined,
        toDefault: "'draft'",
      },
    ]);
  });

  it("dropping a default yields change_column_default with toDefault undefined", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [
        { name: "status", type: "text", nullable: false, default: "'draft'" },
      ],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [{ name: "status", type: "text", nullable: false }],
    });
    const ops = diffSnapshots(prev, cur);
    expect(ops[0]).toEqual({
      type: "change_column_default",
      tableName: "dc_posts",
      columnName: "status",
      fromDefault: "'draft'",
      toDefault: undefined,
    });
  });
});

describe("diffSnapshots - rename detection scope", () => {
  it("does NOT detect renames at the diff layer (emits drop_column + add_column)", () => {
    // Renames are a separate phase: F4's RegexRenameDetector reads
    // (drop_column, add_column) pairs and asks the user. Confirmed
    // renames get merged into rename_column ops by applyResolutions().
    const prev = snap({
      name: "dc_posts",
      columns: [{ name: "title", type: "text", nullable: false }],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [{ name: "name", type: "text", nullable: false }],
    });
    const ops = diffSnapshots(prev, cur);
    expect(ops).toHaveLength(2);
    expect(ops.find(op => op.type === "drop_column")).toBeDefined();
    expect(ops.find(op => op.type === "add_column")).toBeDefined();
  });
});

describe("diffSnapshots - multi-change ops", () => {
  it("combines multiple ops in deterministic order", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [
        { name: "id", type: "int4", nullable: false },
        { name: "title", type: "text", nullable: false },
        { name: "body", type: "text", nullable: true },
      ],
    });
    const cur = snap({
      name: "dc_posts",
      columns: [
        { name: "id", type: "int4", nullable: false },
        { name: "name", type: "text", nullable: false }, // (rename intent)
        { name: "summary", type: "text", nullable: true }, // new column
        // `body` removed
        // `title` removed
      ],
    });
    const ops = diffSnapshots(prev, cur);

    // Expected: 2 drops (body, title), 2 adds (name, summary)
    expect(ops.filter(op => op.type === "drop_column")).toHaveLength(2);
    expect(ops.filter(op => op.type === "add_column")).toHaveLength(2);

    // Sort order: drops alphabetical first, then adds alphabetical
    expect(ops.map(op => op.type)).toEqual([
      "drop_column",
      "drop_column",
      "add_column",
      "add_column",
    ]);
  });

  it("multi-table changes don't cross-pair", () => {
    const prev = snap(
      {
        name: "dc_posts",
        columns: [{ name: "title", type: "text", nullable: false }],
      },
      {
        name: "dc_users",
        columns: [{ name: "id", type: "int4", nullable: false }],
      }
    );
    const cur = snap(
      {
        name: "dc_posts",
        columns: [],
      },
      {
        name: "dc_users",
        columns: [
          { name: "id", type: "int4", nullable: false },
          { name: "email", type: "text", nullable: true },
        ],
      }
    );
    const ops = diffSnapshots(prev, cur);
    // dc_posts: title dropped. dc_users: email added. No cross-pairing.
    expect(ops).toHaveLength(2);
    expect(ops).toContainEqual({
      type: "drop_column",
      tableName: "dc_posts",
      columnName: "title",
      columnType: "text",
    });
    expect(ops).toContainEqual({
      type: "add_column",
      tableName: "dc_users",
      column: { name: "email", type: "text", nullable: true },
    });
  });
});

describe("diffSnapshots - deterministic ordering", () => {
  it("sorts tables alphabetically in op output", () => {
    const prev = empty;
    const cur = snap(
      { name: "dc_zebras", columns: [] },
      { name: "dc_alpha", columns: [] },
      { name: "dc_mango", columns: [] }
    );
    const ops = diffSnapshots(prev, cur);
    expect(
      ops.map(op => (op.type === "add_table" ? op.table.name : "?"))
    ).toEqual(["dc_alpha", "dc_mango", "dc_zebras"]);
  });

  it("table-level ops come before column-level ops", () => {
    const prev = snap({
      name: "dc_posts",
      columns: [{ name: "title", type: "text", nullable: false }],
    });
    const cur = snap(
      {
        name: "dc_new_table",
        columns: [{ name: "id", type: "int4", nullable: false }],
      },
      {
        name: "dc_posts",
        columns: [
          { name: "title", type: "text", nullable: false },
          { name: "name", type: "text", nullable: true },
        ],
      }
    );
    const ops = diffSnapshots(prev, cur);
    // Order: add_table (dc_new_table), then add_column (dc_posts.name)
    expect(ops[0].type).toBe("add_table");
    expect(ops[1].type).toBe("add_column");
  });
});
