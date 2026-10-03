import { describe, expect, it, vi } from "vitest";

import {
  findRetiredAuthTables,
  formatRetiredAuthTablesKept,
  formatRetiredAuthTablesWarning,
  planRetiredAuthTableDrop,
  RETIRED_AUTH_TABLES,
  type RetiredAuthTable,
} from "../retired-auth-tables";

const dialect = "sqlite" as const;

/** Each retired table's columns as Nextly created it. */
const LEGACY_COLUMNS: Record<string, string[]> = {
  accounts: ["id", "user_id", "type", "provider", "provider_account_id"],
  sessions: ["session_token", "user_id", "expires"],
};

function deps(
  present: string[],
  rows: Record<string, number> = {},
  columns: Record<string, string[]> = LEGACY_COLUMNS
) {
  return {
    tableExists: vi.fn(async (t: string) => present.includes(t)),
    columnsOf: vi.fn(async (t: string) => columns[t] ?? []),
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

  it("ignores a table that only shares a retired name", async () => {
    // A host app's own `accounts`, or a session store's `sessions`: neither
    // is Nextly's to report, drop or erase from.
    const d = deps(
      ["accounts", "sessions"],
      { accounts: 4, sessions: 9 },
      {
        accounts: ["id", "owner_id", "balance"],
        sessions: ["sid", "sess", "expire"],
      }
    );
    expect(await findRetiredAuthTables({}, dialect, d)).toEqual([]);
    expect(d.countRows).not.toHaveBeenCalled();
  });

  it("covers exactly the two tables this release retires", () => {
    expect([...RETIRED_AUTH_TABLES]).toEqual(["accounts", "sessions"]);
  });
});

describe("planRetiredAuthTableDrop", () => {
  const withRows: RetiredAuthTable[] = [
    { table: "accounts", rows: 12 },
    { table: "sessions", rows: 0 },
  ];

  it("drops nothing when the operator has not asked", () => {
    expect(
      planRetiredAuthTableDrop(withRows, {
        dropRequested: false,
        allowNonEmpty: true,
      })
    ).toEqual({ drop: [], kept: [] });
  });

  it("drops the empty table and keeps the one with rows, naming it", () => {
    // Accepting the drop is not the same decision as accepting the loss of
    // rows nothing can recreate — and a table with rows does not hold back
    // an empty one.
    const plan = planRetiredAuthTableDrop(withRows, {
      dropRequested: true,
      allowNonEmpty: false,
    });
    expect(plan).toEqual({
      drop: ["sessions"],
      kept: [{ table: "accounts", rows: 12 }],
    });
    expect(formatRetiredAuthTablesKept(plan.kept)).toContain(
      "accounts: 12 rows"
    );
  });

  it("drops a non-empty table only with the second permission", () => {
    expect(
      planRetiredAuthTableDrop(withRows, {
        dropRequested: true,
        allowNonEmpty: true,
      })
    ).toEqual({ drop: ["accounts", "sessions"], kept: [] });
  });

  it("does nothing when there is nothing to drop", () => {
    expect(
      planRetiredAuthTableDrop([], {
        dropRequested: true,
        allowNonEmpty: true,
      })
    ).toEqual({ drop: [], kept: [] });
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
    expect(warning).toContain("NEXTLY_DROP_RETIRED_AUTH_TABLES=1");
    expect(warning).toContain("NEXTLY_DROP_NONEMPTY_RETIRED=1");
  });
});
