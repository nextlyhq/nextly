import { describe, expect, it, vi } from "vitest";

import {
  findRetiredAuthTables,
  formatRetiredAuthDropRefusal,
  formatRetiredAuthTablesWarning,
  planRetiredAuthTableDrop,
  RETIRED_AUTH_TABLES,
  type RetiredAuthTable,
} from "../retired-auth-tables";

const dialect = "sqlite" as const;

function deps(present: string[], rows: Record<string, number> = {}) {
  return {
    tableExists: vi.fn(async (t: string) => present.includes(t)),
    countRows: vi.fn(
      async (_db: unknown, _d: unknown, t: string) => rows[t] ?? 0
    ),
  };
}

describe("findRetiredAuthTables", () => {
  it("reports nothing on a database that never had them", async () => {
    const d = deps([]);
    expect(await findRetiredAuthTables({}, dialect, d)).toEqual([]);
    // The count is never asked for a table that is not there: that query
    // would fail, which is the error this check exists to avoid causing.
    expect(d.countRows).not.toHaveBeenCalled();
  });

  it("reports each table that is present, with its row count", async () => {
    const d = deps(["accounts", "sessions"], { accounts: 3, sessions: 0 });
    expect(await findRetiredAuthTables({}, dialect, d)).toEqual([
      { table: "accounts", rows: 3 },
      { table: "sessions", rows: 0 },
    ]);
  });

  it("reports an empty table too, because the table is the thing to remove", async () => {
    const d = deps(["sessions"]);
    expect(await findRetiredAuthTables({}, dialect, d)).toEqual([
      { table: "sessions", rows: 0 },
    ]);
  });

  it("covers exactly the two tables this release retires", () => {
    expect([...RETIRED_AUTH_TABLES]).toEqual(["accounts", "sessions"]);
  });
});

describe("planRetiredAuthTableDrop", () => {
  const empty: RetiredAuthTable[] = [{ table: "sessions", rows: 0 }];
  const withRows: RetiredAuthTable[] = [
    { table: "accounts", rows: 12 },
    { table: "sessions", rows: 0 },
  ];

  it("keeps them when the operator has not asked for destructive work", () => {
    expect(
      planRetiredAuthTableDrop(withRows, {
        allowDestructive: false,
        allowNonEmpty: true,
      })
    ).toEqual({ action: "keep" });
  });

  it("drops empty tables once destructive work is allowed", () => {
    expect(
      planRetiredAuthTableDrop(empty, {
        allowDestructive: true,
        allowNonEmpty: false,
      })
    ).toEqual({ action: "drop", tables: ["sessions"] });
  });

  it("refuses a table that still holds rows, naming it", () => {
    // Accepting a schema change is not the same decision as accepting the
    // loss of rows nothing can recreate.
    const plan = planRetiredAuthTableDrop(withRows, {
      allowDestructive: true,
      allowNonEmpty: false,
    });
    expect(plan).toEqual({
      action: "refuse",
      nonEmpty: [{ table: "accounts", rows: 12 }],
    });
    expect(
      formatRetiredAuthDropRefusal([{ table: "accounts", rows: 12 }])
    ).toContain("accounts: 12 rows");
  });

  it("drops a non-empty table only with the second permission", () => {
    expect(
      planRetiredAuthTableDrop(withRows, {
        allowDestructive: true,
        allowNonEmpty: true,
      })
    ).toEqual({ action: "drop", tables: ["accounts", "sessions"] });
  });

  it("does nothing when there is nothing to drop", () => {
    expect(
      planRetiredAuthTableDrop([], {
        allowDestructive: true,
        allowNonEmpty: true,
      })
    ).toEqual({ action: "keep" });
  });
});

describe("formatRetiredAuthTablesWarning", () => {
  it("names each table, its rows, and how to remove it", () => {
    const warning = formatRetiredAuthTablesWarning([
      { table: "accounts", rows: 1 },
      { table: "sessions", rows: 4 },
    ]);
    expect(warning).toContain("accounts: 1 row");
    expect(warning).toContain("sessions: 4 rows");
    expect(warning).toContain("NEXTLY_ALLOW_CORE_DESTRUCTIVE=1");
    expect(warning).toContain("NEXTLY_DROP_NONEMPTY_RETIRED=1");
  });
});
