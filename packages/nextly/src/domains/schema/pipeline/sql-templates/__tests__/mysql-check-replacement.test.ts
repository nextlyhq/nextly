// A migration file replaces a MySQL check in one statement, as an apply does:
// MySQL commits each DDL statement, so a drop written apart from its add leaves
// the column unconstrained when the add fails over a row it would refuse.

import { describe, expect, it } from "vitest";

import type { Operation } from "../../diff/types";
import { generateStatements } from "../index";

const narrowing: Operation[] = [
  {
    type: "drop_check",
    tableName: "cx__items",
    check: { name: "ck_cx__items_status", sql: "`status` IN ('a', 'b')" },
  },
  {
    type: "add_column",
    tableName: "cx__items",
    column: { name: "note", type: "text", nullable: true },
  },
  {
    type: "add_check",
    tableName: "cx__items",
    check: { name: "ck_cx__items_status", sql: "`status` IN ('a')" },
  },
];

describe("generateStatements: a replaced MySQL check", () => {
  it("is one ALTER TABLE at the add, the rest in order", () => {
    const statements = generateStatements(narrowing, "mysql", []);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("ADD COLUMN");
    expect(statements[1]).toBe(
      "ALTER TABLE `cx__items` DROP CHECK `ck_cx__items_status`, ADD CONSTRAINT `ck_cx__items_status` CHECK (`status` IN ('a'))"
    );
  });

  it("stays a drop and an add when the same file alters the column", () => {
    const statements = generateStatements(
      [
        narrowing[0],
        {
          type: "drop_column",
          tableName: "cx__items",
          columnName: "status",
          columnType: "text",
        },
        narrowing[2],
      ],
      "mysql",
      []
    );
    expect(statements).toHaveLength(3);
    expect(statements[0]).not.toContain("ADD CONSTRAINT");
    expect(statements[0]).toContain("DROP CHECK");
  });

  it("leaves PostgreSQL's transactional drop and add as they are", () => {
    const statements = generateStatements(narrowing, "postgresql", []);
    expect(statements).toHaveLength(3);
  });
});
