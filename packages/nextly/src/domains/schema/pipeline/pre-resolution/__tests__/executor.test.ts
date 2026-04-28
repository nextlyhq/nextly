import { describe, expect, it, vi } from "vitest";

import type {
  DropColumnOp,
  DropTableOp,
  Operation,
  RenameColumnOp,
  RenameTableOp,
} from "../../diff/types.js";
import { executePreResolutionOps } from "../executor.js";

// Mock tx that records the SQL strings it executed.
function makeRecordingTx() {
  const executed: string[] = [];
  const tx = {
    execute: vi.fn(async (sql: { _sql?: string } | string) => {
      // Drizzle's sql.raw() yields a tagged value with chunks; we just record
      // its toString() for assertion purposes.
      executed.push(typeof sql === "string" ? sql : extractSqlString(sql));
      return { rows: [] };
    }),
  };
  return { tx, executed };
}

function extractSqlString(sql: unknown): string {
  // drizzle's sql.raw(s) builds an SQL object with internal chunks. For
  // testing we rely on the structural property: the executor passes its
  // raw string to sql.raw(), which we can extract via the test-mode tag.
  // The recorded shape is `{ queryChunks: [...], shouldInlineParams: ... }`.
  // We just stringify and grep for the SQL command.
  if (sql && typeof sql === "object" && "queryChunks" in sql) {
    const chunks = (sql as { queryChunks: unknown[] }).queryChunks;
    return chunks
      .map(c => {
        if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: string[] }).value;
          return Array.isArray(v) ? v.join("") : String(v);
        }
        return String(c);
      })
      .join("");
  }
  return String(sql);
}

describe("executePreResolutionOps - PG/MySQL", () => {
  it("filters non-pre-resolution ops and runs nothing if list is empty", async () => {
    const { tx, executed } = makeRecordingTx();
    const addOnly: Operation[] = [
      {
        type: "add_column",
        tableName: "dc_posts",
        column: { name: "x", type: "text", nullable: true },
      },
    ];

    const count = await executePreResolutionOps(tx, addOnly, "postgresql");

    expect(count).toBe(0);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
  });

  it("runs renames before drops (so subsequent drops reference new names if needed)", async () => {
    const { tx, executed } = makeRecordingTx();
    const ops: Operation[] = [
      {
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "body",
        columnType: "text",
      } satisfies DropColumnOp,
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      } satisfies RenameColumnOp,
    ];

    const count = await executePreResolutionOps(tx, ops, "postgresql");

    expect(count).toBe(2);
    // Renames first, then drops.
    expect(executed[0]).toContain("RENAME COLUMN");
    expect(executed[1]).toContain("DROP COLUMN");
  });

  it("runs rename_table before rename_column (table renames first)", async () => {
    const { tx, executed } = makeRecordingTx();
    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: "dc_new_posts", // already-renamed table name
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      } satisfies RenameColumnOp,
      {
        type: "rename_table",
        fromName: "dc_posts",
        toName: "dc_new_posts",
      } satisfies RenameTableOp,
    ];

    const count = await executePreResolutionOps(tx, ops, "postgresql");

    expect(count).toBe(2);
    // Table rename before column rename.
    expect(executed[0]).toContain("RENAME TO");
    expect(executed[1]).toContain("RENAME COLUMN");
  });

  it("runs drop_column before drop_table (clean column-level state first)", async () => {
    const { tx, executed } = makeRecordingTx();
    const ops: Operation[] = [
      {
        type: "drop_table",
        tableName: "dc_old",
      } satisfies DropTableOp,
      {
        type: "drop_column",
        tableName: "dc_other",
        columnName: "body",
        columnType: "text",
      } satisfies DropColumnOp,
    ];

    const count = await executePreResolutionOps(tx, ops, "postgresql");

    expect(count).toBe(2);
    expect(executed[0]).toContain('DROP COLUMN "body"');
    expect(executed[1]).toContain('DROP TABLE "dc_old"');
  });

  it("safe order: rename_table -> rename_column -> drop_column -> drop_table", async () => {
    const { tx, executed } = makeRecordingTx();
    const ops: Operation[] = [
      {
        type: "drop_table",
        tableName: "dc_zombie",
      } satisfies DropTableOp,
      {
        type: "rename_column",
        tableName: "dc_new",
        fromColumn: "a",
        toColumn: "b",
        fromType: "text",
        toType: "text",
      } satisfies RenameColumnOp,
      {
        type: "drop_column",
        tableName: "dc_new",
        columnName: "old",
        columnType: "text",
      } satisfies DropColumnOp,
      {
        type: "rename_table",
        fromName: "dc_old",
        toName: "dc_new",
      } satisfies RenameTableOp,
    ];

    const count = await executePreResolutionOps(tx, ops, "postgresql");

    expect(count).toBe(4);
    expect(executed[0]).toContain("RENAME TO"); // rename_table
    expect(executed[1]).toContain("RENAME COLUMN"); // rename_column
    expect(executed[2]).toContain("DROP COLUMN"); // drop_column
    expect(executed[3]).toContain("DROP TABLE"); // drop_table
  });

  it("dialect quoting: mysql uses backticks", async () => {
    const { tx, executed } = makeRecordingTx();
    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      } satisfies RenameColumnOp,
    ];

    await executePreResolutionOps(tx, ops, "mysql");

    expect(executed[0]).toContain("`dc_posts`");
    expect(executed[0]).toContain("`title`");
    expect(executed[0]).toContain("`name`");
  });
});

describe("executePreResolutionOps - SQLite", () => {
  it("uses db.run instead of db.execute on SQLite (better-sqlite3 wrapper)", async () => {
    const executed: string[] = [];
    const db = {
      run: vi.fn((sql: unknown) => {
        executed.push(extractSqlString(sql));
      }),
    };
    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      } satisfies RenameColumnOp,
    ];

    const count = await executePreResolutionOps(db, ops, "sqlite");

    expect(count).toBe(1);
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(executed[0]).toContain("RENAME COLUMN");
  });
});
