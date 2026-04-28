// Unit tests for per-dialect count helpers used by RealClassifier to
// populate add_not_null_with_nulls events with NULL row counts.

import { describe, it, expect, vi } from "vitest";

import { countNulls, countRows } from "../count-helpers.js";

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
