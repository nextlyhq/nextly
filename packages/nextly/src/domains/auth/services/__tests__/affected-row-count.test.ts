/**
 * `affectedRowCount` is the one dialect-specific piece of the invite flow — the
 * atomic-claim check reads it to know whether it won a race. Each driver
 * reports the count in a different field, so each shape is pinned here.
 */
import { describe, expect, it } from "vitest";

import { affectedRowCount } from "../auth-service";

describe("affectedRowCount", () => {
  it("reads better-sqlite3's `changes`", () => {
    expect(affectedRowCount({ changes: 1, lastInsertRowid: 5 }, "sqlite")).toBe(
      1
    );
    expect(affectedRowCount({ changes: 0 }, "sqlite")).toBe(0);
  });

  it("reads node-postgres's `rowCount`", () => {
    expect(affectedRowCount({ rowCount: 1, rows: [] }, "postgresql")).toBe(1);
    expect(affectedRowCount({ rowCount: 0 }, "postgresql")).toBe(0);
  });

  it("reads mysql2's ResultSetHeader `affectedRows`, in an array", () => {
    expect(affectedRowCount([{ affectedRows: 1 }], "mysql")).toBe(1);
    expect(affectedRowCount([{ affectedRows: 0 }], "mysql")).toBe(0);
  });

  it("reads mysql2's header when returned directly", () => {
    expect(affectedRowCount({ affectedRows: 1 }, "mysql")).toBe(1);
  });

  it("treats a missing count as zero rather than throwing", () => {
    expect(affectedRowCount({}, "sqlite")).toBe(0);
    expect(affectedRowCount({}, "postgresql")).toBe(0);
    expect(affectedRowCount([], "mysql")).toBe(0);
    expect(affectedRowCount({}, "mysql")).toBe(0);
  });
});
