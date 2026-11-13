// A check replaced in a generated MySQL migration runs as one statement per
// table. MySQL commits each schema statement on its own, so a drop written as
// its own statement is already committed when the add replacing it fails over a
// row it refuses, and the column is left with no check at all.

import { describe, expect, it } from "vitest";

import type { Operation, TableSpec } from "../../diff/types";
import { generateStatements } from "../index";

const items: TableSpec = {
  name: "cx__items",
  columns: [
    { name: "id", type: "text", nullable: false, primaryKey: true },
    { name: "state", type: "varchar(16)", nullable: true },
  ],
};

const narrowing: Operation[] = [
  {
    type: "drop_check",
    tableName: "cx__items",
    check: { name: "ck_state", sql: "`state` IN ('draft', 'live')" },
  },
  {
    type: "add_check",
    tableName: "cx__items",
    check: { name: "ck_state", sql: "`state` IN ('draft')" },
  },
];

describe("generateStatements: MySQL check replacement", () => {
  it("writes a narrowed check as ONE statement, so a refused add leaves the old check", () => {
    expect(generateStatements(narrowing, "mysql", [items])).toEqual([
      "ALTER TABLE `cx__items` DROP CHECK `ck_state`, ADD CONSTRAINT `ck_state` CHECK (`state` IN ('draft'))",
    ]);
  });

  it("writes checks that exchange names as one statement, every drop first", () => {
    const swapped: Operation[] = [
      {
        type: "drop_check",
        tableName: "cx__items",
        check: { name: "ck_a", sql: "`x` IN ('p')" },
      },
      {
        type: "drop_check",
        tableName: "cx__items",
        check: { name: "ck_b", sql: "`y` IN ('p')" },
      },
      {
        type: "add_check",
        tableName: "cx__items",
        check: { name: "ck_b", sql: "`x` IN ('p', 'q')" },
      },
      {
        type: "add_check",
        tableName: "cx__items",
        check: { name: "ck_a", sql: "`y` IN ('p', 'q')" },
      },
    ];
    expect(generateStatements(swapped, "mysql", [items])).toEqual([
      "ALTER TABLE `cx__items` DROP CHECK `ck_a`, DROP CHECK `ck_b`, ADD CONSTRAINT `ck_b` CHECK (`x` IN ('p', 'q')), ADD CONSTRAINT `ck_a` CHECK (`y` IN ('p', 'q'))",
    ]);
  });

  it("keeps the other operations where they stood around the replacement", () => {
    const withIndex: Operation[] = [
      ...narrowing,
      {
        type: "drop_index",
        tableName: "cx__items",
        index: {
          name: "idx_cx__items_state",
          columns: ["state"],
          unique: false,
        },
      },
    ];
    const statements = generateStatements(withIndex, "mysql", [items]);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("DROP CHECK `ck_state`, ADD CONSTRAINT");
    expect(statements[1]).toContain("idx_cx__items_state");
  });

  it("leaves a drop and add apart where the column itself changes type", () => {
    // The type change needs the old check gone first, so it cannot wait for
    // the add: the pair stays two statements around the change.
    const retyped: Operation[] = [
      narrowing[0] as Operation,
      {
        type: "change_column_type",
        tableName: "cx__items",
        columnName: "state",
        fromType: "varchar(16)",
        toType: "varchar(32)",
      },
      narrowing[1] as Operation,
    ];
    const statements = generateStatements(retyped, "mysql", [items]);
    expect(statements[0]).toBe("ALTER TABLE `cx__items` DROP CHECK `ck_state`");
    expect(statements.at(-1)).toContain("ADD CONSTRAINT `ck_state`");
    expect(statements.some(s => s.includes("DROP CHECK `ck_state`, "))).toBe(
      false
    );
  });

  it("changes nothing on PostgreSQL, whose schema statements a transaction undoes", () => {
    const statements = generateStatements(narrowing, "postgresql", [items]);
    expect(statements).toHaveLength(2);
  });
});
