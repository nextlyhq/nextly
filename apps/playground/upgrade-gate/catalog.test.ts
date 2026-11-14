/**
 * The upgrade gate's comparison, apart from any database: which operations two
 * catalogs differ by, and how a plan is judged against the allowlist.
 */
import { describe, expect, it } from "vitest";

import { ALLOWED_OPERATIONS } from "./allowlist";
import {
  DIALECTS,
  emptyTable,
  judge,
  operationsBetween,
  verdictMessage,
  type Catalog,
  type TableShape,
} from "./catalog";

function table(shape: Partial<TableShape>): TableShape {
  return { ...emptyTable(), ...shape };
}

const before: Catalog = {
  users: table({
    columns: { id: "text not null primary key 1", email: "text not null" },
    indexes: { users_email_idx: "unique (email)" },
  }),
  retired: table({ columns: { id: "text" } }),
};

describe("operationsBetween", () => {
  it("finds nothing between a catalog and itself", () => {
    expect(operationsBetween(before, structuredClone(before))).toEqual([]);
  });

  it("names each element added, dropped or changed, and each table made or gone", () => {
    const after: Catalog = {
      users: table({
        columns: {
          id: "text not null primary key 1",
          email: "text null",
          name: "text null",
        },
        indexes: { users_name_idx: "(name)" },
        constraints: { users_pkey: "PRIMARY KEY (id)" },
        triggers: { users_touch: "after update ..." },
      }),
      sessions: table({ columns: { id: "text" } }),
    };
    expect(operationsBetween(before, after)).toEqual([
      "add column users.name: text null",
      "add constraint users.users_pkey: PRIMARY KEY (id)",
      "change column users.email: text not null -> text null",
      "create index users.users_name_idx: (name)",
      "create table sessions",
      "create trigger users.users_touch: after update ...",
      "drop index users.users_email_idx",
      "drop table retired",
    ]);
  });

  it("reads an index rebuilt under its name with other columns as a change", () => {
    const after = structuredClone(before);
    after.users.indexes.users_email_idx = "unique (email, id)";
    expect(operationsBetween(before, after)).toEqual([
      "change index users.users_email_idx: unique (email) -> unique (email, id)",
    ]);
  });
});

describe("judge", () => {
  const allowlist = [
    { operation: "create table sessions", reason: "new" },
    {
      operation: "create index users.users_name_idx: (name)",
      dialects: ["sqlite" as const],
      reason: "declared",
    },
  ];

  it("passes a plan that is exactly the dialect's allowlist", () => {
    expect(
      judge(
        ["create index users.users_name_idx: (name)", "create table sessions"],
        allowlist,
        "sqlite"
      )
    ).toEqual({ unexpected: [], stale: [] });
  });

  it("names a planned operation the allowlist lacks, and an entry for another dialect does not cover it", () => {
    const verdict = judge(
      ["create index users.users_name_idx: (name)", "create table sessions"],
      allowlist,
      "mysql"
    );
    expect(verdict).toEqual({
      unexpected: ["create index users.users_name_idx: (name)"],
      stale: [],
    });
    const message = verdictMessage(verdict, "mysql", "nextly 1.0.0");
    expect(message).toContain(
      "plans 1 operation(s) on mysql that upgrade-gate/allowlist.ts does not hold"
    );
    expect(message).toContain(
      '{ operation: "create index users.users_name_idx: (name)", dialects: ["mysql"], reason: "..." },'
    );
  });

  it("names an allowlisted operation the upgrade no longer plans", () => {
    const verdict = judge([], allowlist, "postgresql");
    expect(verdict).toEqual({
      unexpected: [],
      stale: ["create table sessions"],
    });
    expect(verdictMessage(verdict, "postgresql", "nextly 1.0.0")).toContain(
      "  - create table sessions"
    );
  });
});

describe("the allowlist", () => {
  it("gives every entry a reason and lists no operation twice on a dialect", () => {
    for (const entry of ALLOWED_OPERATIONS) {
      expect(entry.reason.trim(), entry.operation).not.toBe("");
    }
    for (const dialect of DIALECTS) {
      const operations = ALLOWED_OPERATIONS.filter(
        entry => entry.dialects?.includes(dialect) ?? true
      ).map(entry => entry.operation);
      expect(operations.length, dialect).toBe(new Set(operations).size);
    }
  });
});
