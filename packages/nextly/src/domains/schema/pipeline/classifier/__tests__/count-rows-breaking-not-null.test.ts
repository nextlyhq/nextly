/**
 * The one count of rows that would break a column becoming NOT NULL: every
 * road that makes a column required asks it before anything runs.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { countRowsBreakingNotNull } from "../count-helpers";

describe("countRowsBreakingNotNull on a real SQLite database", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    db = drizzle({ client: sqlite });
    sqlite.exec(
      `CREATE TABLE "dc_posts-archive" (id TEXT, title TEXT, body TEXT)`
    );
    sqlite.exec(
      `INSERT INTO "dc_posts-archive" VALUES ('1', 'a', NULL), ('2', NULL, NULL), ('3', 'c', 'x')`
    );
    sqlite.exec(
      `CREATE TABLE fg_hero (_parent_table TEXT, _parent_id TEXT, cta TEXT)`
    );
    sqlite.exec(
      `INSERT INTO fg_hero VALUES
        ('dc_posts', '1', NULL), ('dc_posts', '2', NULL), ('dc_pages', '1', 'go'),
        ('single_home', '1', NULL)`
    );
  });
  afterEach(() => sqlite.close());

  it("counts the null rows of a column, under a name a hyphen keeps quoted", async () => {
    expect(
      await countRowsBreakingNotNull(db, "sqlite", {
        table: "dc_posts-archive",
        column: "body",
      })
    ).toEqual({ total: 2, byParentTable: new Map() });
    expect(
      await countRowsBreakingNotNull(db, "sqlite", {
        table: "dc_posts-archive",
        column: "title",
      })
    ).toEqual({ total: 1, byParentTable: new Map() });
  });

  it("counts every row for a required column added without a default", async () => {
    expect(
      await countRowsBreakingNotNull(db, "sqlite", {
        table: "dc_posts-archive",
        column: null,
      })
    ).toEqual({ total: 3, byParentTable: new Map() });
  });

  it("splits a field group's rows by the collection or Single that holds them", async () => {
    expect(
      await countRowsBreakingNotNull(db, "sqlite", {
        table: "fg_hero",
        column: "cta",
        byParent: true,
      })
    ).toEqual({
      total: 3,
      byParentTable: new Map([
        ["dc_posts", 2],
        ["single_home", 1],
      ]),
    });
  });

  it("answers no rows for an empty table", async () => {
    sqlite.exec(`DELETE FROM fg_hero`);
    expect(
      await countRowsBreakingNotNull(db, "sqlite", {
        table: "fg_hero",
        column: "cta",
        byParent: true,
      })
    ).toEqual({ total: 0, byParentTable: new Map() });
  });
});

describe("countRowsBreakingNotNull on each driver's result shape", () => {
  it("reads PostgreSQL's rows, with string counts", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { parent: "dc_posts", count: "4" },
        { parent: "single_home", count: "1" },
      ],
    });
    expect(
      await countRowsBreakingNotNull({ execute }, "postgresql", {
        table: "fg_hero",
        column: "cta",
        byParent: true,
      })
    ).toEqual({
      total: 5,
      byParentTable: new Map([
        ["dc_posts", 4],
        ["single_home", 1],
      ]),
    });
  });

  it("reads MySQL's [rows, fields] shape", async () => {
    const execute = vi.fn().mockResolvedValue([[{ count: 6 }], []]);
    expect(
      await countRowsBreakingNotNull({ execute }, "mysql", {
        table: "dc_posts",
        column: "title",
      })
    ).toEqual({ total: 6, byParentTable: new Map() });
  });
});
