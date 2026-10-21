// Unit tests for per-dialect count helpers used by RealClassifier to
// populate add_not_null_with_nulls events with NULL row counts.

import { describe, it, expect, vi } from "vitest";

import { countLongerThan, countNulls, countRows } from "../count-helpers";

describe("countNulls", () => {
  it("PG: queries SELECT COUNT(*) ... WHERE col IS NULL", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ count: "3" }] });
    const db = { execute };
    const n = await countNulls(db, "postgresql", "dc_users", "email");
    expect(n).toBe(3);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("MySQL: handles flat array shape", async () => {
    const execute = vi.fn().mockResolvedValue([[{ count: 5 }], []]);
    const db = { execute };
    const n = await countNulls(db, "mysql", "dc_users", "email");
    expect(n).toBe(5);
  });

  it("SQLite: uses db.all() and returns first row", async () => {
    const all = vi.fn().mockReturnValue([{ count: 7 }]);
    const db = { all };
    const n = await countNulls(db, "sqlite", "dc_users", "email");
    expect(n).toBe(7);
  });

  it("rejects identifiers with embedded quote characters", async () => {
    const db = { execute: vi.fn() };
    await expect(
      countNulls(db, "postgresql", 'dc_users"injected', "email")
    ).rejects.toThrow(/identifier/i);
  });

  it("rejects identifiers with embedded semicolons", async () => {
    const db = { execute: vi.fn() };
    await expect(
      countNulls(db, "postgresql", "dc_users; DROP TABLE x", "email")
    ).rejects.toThrow(/identifier/i);
  });
});

describe("countRows", () => {
  it("PG: queries SELECT COUNT(*) FROM table", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ count: "47" }] });
    const db = { execute };
    const n = await countRows(db, "postgresql", "dc_users");
    expect(n).toBe(47);
  });

  it("SQLite: uses db.all()", async () => {
    const all = vi.fn().mockReturnValue([{ count: 50 }]);
    const db = { all };
    const n = await countRows(db, "sqlite", "dc_users");
    expect(n).toBe(50);
  });
});

// The values a narrowing to varchar(N) would cut short, counted in characters. The query is read
// back through each dialect's own renderer: the identifiers must come out quoted for that dialect
// and the bound must travel as a parameter, never inside the SQL text.
describe("countLongerThan", () => {
  const rendered = async (dialect: "mysql" | "postgresql") => {
    const execute = vi
      .fn()
      .mockResolvedValue(
        dialect === "mysql" ? [[{ count: 2 }], []] : { rows: [{ count: "2" }] }
      );
    const n = await countLongerThan(
      { execute },
      dialect,
      "single_site",
      "title",
      255
    );
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const renderer = dialect === "mysql" ? new MySqlDialect() : new PgDialect();
    return { n, query: renderer.sqlToQuery(execute.mock.calls[0][0]) };
  };

  it("MySQL: counts by CHAR_LENGTH with quoted identifiers and a bound length", async () => {
    const { n, query } = await rendered("mysql");
    expect(n).toBe(2);
    expect(query.sql).toBe(
      "SELECT COUNT(*) AS count FROM `single_site` WHERE CHAR_LENGTH(`title`) > ?"
    );
    expect(query.params).toEqual([255]);
  });

  it("PostgreSQL: counts by CHAR_LENGTH with quoted identifiers and a bound length", async () => {
    const { n, query } = await rendered("postgresql");
    expect(n).toBe(2);
    expect(query.sql).toBe(
      'SELECT COUNT(*) AS count FROM "single_site" WHERE CHAR_LENGTH("title") > $1'
    );
    expect(query.params).toEqual([255]);
  });

  it("counts a table whose configured name needs quoting, such as one with a hyphen", async () => {
    // A custom `dbName` like `my-table` is accepted by the naming rules and created verbatim, so
    // its narrowing has to be countable; the identifier quoting carries the name, escaped.
    const execute = vi.fn().mockResolvedValue([[{ count: 0 }], []]);
    await expect(
      countLongerThan({ execute }, "mysql", "dc_my-table", "title", 10)
    ).resolves.toBe(0);
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    expect(new MySqlDialect().sqlToQuery(execute.mock.calls[0][0]).sql).toBe(
      "SELECT COUNT(*) AS count FROM `dc_my-table` WHERE CHAR_LENGTH(`title`) > ?"
    );
  });

  it("reports a count query that returned no row as a NextlyError", async () => {
    await expect(
      countLongerThan(
        { all: vi.fn().mockReturnValue([]) },
        "sqlite",
        "t",
        "c",
        1
      )
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
