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

  it("places the replacement at the add, the operations between it in order", () => {
    const statements = generateStatements(
      [
        narrowing[0] as Operation,
        {
          type: "add_column",
          tableName: "cx__items",
          column: { name: "note", type: "text", nullable: true },
        },
        narrowing[1] as Operation,
      ],
      "mysql",
      [items]
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("ADD COLUMN");
    expect(statements[1]).toBe(
      "ALTER TABLE `cx__items` DROP CHECK `ck_state`, ADD CONSTRAINT `ck_state` CHECK (`state` IN ('draft'))"
    );
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

  it("keeps the old check through a type change of its column, replacing it after", () => {
    // MODIFY leaves a check in force, so the old one holds through the change
    // and the replacement after it fails whole over a row it refuses.
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
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("MODIFY COLUMN `state` varchar(32)");
    expect(statements[1]).toBe(
      "ALTER TABLE `cx__items` DROP CHECK `ck_state`, ADD CONSTRAINT `ck_state` CHECK (`state` IN ('draft'))"
    );
  });

  it("keeps the old check through a rename of its column, which carries it across", () => {
    // The file's rename drops and re-adds the column's checks around RENAME
    // COLUMN in one statement, so the old check reaches the new name and is
    // replaced after it, never dropped on its own ahead.
    const renamed: Operation[] = [
      narrowing[0] as Operation,
      {
        type: "rename_column",
        tableName: "cx__items",
        fromColumn: "state",
        toColumn: "status",
        fromType: "varchar(16)",
        toType: "varchar(16)",
      },
      {
        type: "add_check",
        tableName: "cx__items",
        check: { name: "ck_status", sql: "`status` IN ('draft')" },
      },
    ];
    const statements = generateStatements(renamed, "mysql", [items]);
    expect(
      statements.some(s =>
        /^ALTER TABLE `cx__items` DROP CHECK `ck_state`$/.test(s)
      )
    ).toBe(false);
    expect(statements.at(-1)).toBe(
      "ALTER TABLE `cx__items` DROP CHECK `ck_state`, ADD CONSTRAINT `ck_status` CHECK (`status` IN ('draft'))"
    );
  });

  it("drops the check ahead of a drop of its column, which MySQL requires", () => {
    const statements = generateStatements(
      [
        narrowing[0] as Operation,
        {
          type: "drop_column",
          tableName: "cx__items",
          columnName: "state",
          columnType: "varchar(16)",
        },
        narrowing[1] as Operation,
      ],
      "mysql",
      [items]
    );
    expect(statements[0]).toBe("ALTER TABLE `cx__items` DROP CHECK `ck_state`");
    expect(statements.some(s => s.includes("DROP CHECK `ck_state`, "))).toBe(
      false
    );
  });

  it("changes nothing on PostgreSQL, whose schema statements a transaction undoes", () => {
    const statements = generateStatements(narrowing, "postgresql", [items]);
    expect(statements).toHaveLength(2);
  });
});
