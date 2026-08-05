/**
 * The driver shapes here are transcribed from real output, not imagined: the PostgreSQL and
 * SQLite rows were captured by running these exact queries against PostgreSQL 17 and SQLite
 * 3.51, and MySQL's tuple wrapper is the documented mysql2 return. A fixture invented from the
 * query text would certify a reader that fails on the real thing — SQLite's `PRAGMA
 * foreign_key_list` names the referencing column `from`, which nothing in the query says.
 */
import { describe, expect, it, vi } from "vitest";

import {
  readForeignKeyColumns,
  readIndexNames,
  tableHasRows,
} from "../live-table-facts";

/** One row of `PRAGMA foreign_key_list("dc_posts")`, verbatim from SQLite 3.51. */
const SQLITE_FK_ROW = {
  id: 0,
  seq: 0,
  table: "dc_authors",
  from: "author",
  to: "id",
  on_update: "NO ACTION",
  on_delete: "SET NULL",
  match: "NONE",
};

describe("tableHasRows", () => {
  it("reads postgres' QueryResult wrapper rather than the result object itself", async () => {
    const empty = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const filled = {
      execute: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    };

    expect(await tableHasRows(empty, "postgresql", "dc_posts")).toBe(false);
    expect(await tableHasRows(filled, "postgresql", "dc_posts")).toBe(true);
  });

  it("unwraps mysql's [rows, fields] tuple", async () => {
    const empty = { execute: vi.fn().mockResolvedValue([[], []]) };
    const filled = { execute: vi.fn().mockResolvedValue([[{ "1": 1 }], []]) };

    expect(await tableHasRows(empty, "mysql", "dc_posts")).toBe(false);
    expect(await tableHasRows(filled, "mysql", "dc_posts")).toBe(true);
  });

  it("accepts a mysql wrapper that already flattened the tuple to rows", async () => {
    const flattened = { execute: vi.fn().mockResolvedValue([{ "1": 1 }]) };

    expect(await tableHasRows(flattened, "mysql", "dc_posts")).toBe(true);
  });

  it("reads sqlite's flat row array", async () => {
    const empty = { all: vi.fn().mockResolvedValue([]) };
    const filled = { all: vi.fn().mockResolvedValue([{ "1": 1 }]) };

    expect(await tableHasRows(empty, "sqlite", "dc_posts")).toBe(false);
    expect(await tableHasRows(filled, "sqlite", "dc_posts")).toBe(true);
  });

  it("asks for existence, not a count, so the cost does not grow with the table", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await tableHasRows({ execute }, "postgresql", "dc_posts");

    const query = JSON.stringify(execute.mock.calls[0][0]);
    expect(query).toContain("LIMIT 1");
    expect(query).not.toContain("count");
  });
});

describe("readIndexNames", () => {
  it("reads postgres index names", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ indexname: "dc_posts_pkey" }, { indexname: "idx_dc_posts_a" }],
    });

    const found = await readIndexNames({ execute }, "postgresql", "dc_posts");

    expect([...found].sort()).toEqual(["dc_posts_pkey", "idx_dc_posts_a"]);
  });

  it("reads mysql index names through the tuple wrapper, deduplicated", async () => {
    // One row per indexed COLUMN, so a composite index appears more than once.
    const execute = vi
      .fn()
      .mockResolvedValue([[{ INDEX_NAME: "idx_dc_posts_a" }], []]);

    const found = await readIndexNames({ execute }, "mysql", "dc_posts");

    expect([...found]).toEqual(["idx_dc_posts_a"]);
  });

  it("reads sqlite's PRAGMA index_list rows", async () => {
    const all = vi
      .fn()
      .mockResolvedValue([
        { seq: 0, name: "idx_dc_posts_a", unique: 0, origin: "c", partial: 0 },
      ]);

    const found = await readIndexNames({ all }, "sqlite", "dc_posts");

    expect(found.has("idx_dc_posts_a")).toBe(true);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "reports an empty set for a table with no index (%s)",
    async dialect => {
      const db = {
        execute: vi
          .fn()
          .mockResolvedValue(dialect === "mysql" ? [[], []] : { rows: [] }),
        all: vi.fn().mockResolvedValue([]),
      };

      expect((await readIndexNames(db, dialect, "dc_plain")).size).toBe(0);
    }
  );
});

describe("readForeignKeyColumns", () => {
  it("keys postgres constraints by their column", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ column_name: "author", constraint_name: "fk_dc_posts_author" }],
    });

    const found = await readForeignKeyColumns(
      { execute },
      "postgresql",
      "dc_posts"
    );

    expect(found.has("author")).toBe(true);
    expect(found.get("author")).toEqual(["fk_dc_posts_author"]);
    expect(found.has("title")).toBe(false);
  });

  it("keys mysql constraints by their column, through the tuple wrapper", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([
        [{ COLUMN_NAME: "author", CONSTRAINT_NAME: "fk_dc_posts_author" }],
        [],
      ]);

    const found = await readForeignKeyColumns({ execute }, "mysql", "dc_posts");

    expect(found.get("author")).toEqual(["fk_dc_posts_author"]);
  });

  it("excludes mysql's primary and unique keys, which share the same view", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);

    await readForeignKeyColumns({ execute }, "mysql", "dc_posts");

    expect(JSON.stringify(execute.mock.calls[0][0])).toContain(
      "REFERENCED_TABLE_NAME IS NOT NULL"
    );
  });

  it("reads the referencing column from sqlite's `from`, and reports no name for it", async () => {
    const all = vi.fn().mockResolvedValue([SQLITE_FK_ROW]);

    const found = await readForeignKeyColumns({ all }, "sqlite", "dc_posts");

    // Presence is the fact every caller needs; SQLite exposes no constraint name to drop.
    expect(found.has("author")).toBe(true);
    expect(found.get("author")).toEqual([]);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "returns an empty map for a table with no foreign key (%s)",
    async dialect => {
      const db = {
        execute: vi
          .fn()
          .mockResolvedValue(dialect === "mysql" ? [[], []] : { rows: [] }),
        all: vi.fn().mockResolvedValue([]),
      };

      const found = await readForeignKeyColumns(db, dialect, "dc_plain");

      expect(found.size).toBe(0);
    }
  );
});
