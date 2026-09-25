// The checks and foreign keys an apply on drizzle-kit's route runs itself.
//
// Which side of the kit's batch each statement lands on is the property: a
// drop after the kit, or an add before a table exists, fails at run time, and
// on MySQL a foreign key left in place makes a type change on its column fail.

import { describe, expect, it } from "vitest";

import type { ForeignKeySpec, Operation, TableSpec } from "../diff/types";
import { kitRouteConstraintStatements } from "../kit-route-constraints";

const shelfKey: ForeignKeySpec = {
  name: "fk_cx__items_shelf_id",
  columns: ["shelf_id"],
  referencesTable: "cx__shelves",
  referencesColumns: ["id"],
  onDelete: "no action",
  onUpdate: "no action",
};
const items: TableSpec = {
  name: "cx__items",
  columns: [
    { name: "id", type: "text", nullable: false, primaryKey: true },
    { name: "shelf_id", type: "text", nullable: false },
  ],
  checks: [{ name: "ck_cx__items_quantity", sql: "quantity >= 0" }],
  foreignKeys: [shelfKey],
};
const shelves: TableSpec = {
  name: "cx__shelves",
  columns: [{ name: "id", type: "text", nullable: false, primaryKey: true }],
};

const rekey: Operation[] = [
  {
    type: "drop_check",
    tableName: "cx__items",
    check: { name: "ck_cx__items_status_enum", sql: "status IN ('a')" },
  },
  {
    type: "add_check",
    tableName: "cx__items",
    check: { name: "ck_cx__items_status_enum", sql: "status IN ('a', 'b')" },
  },
  { type: "add_foreign_key", tableName: "cx__items", foreignKey: shelfKey },
];

describe("kitRouteConstraintStatements", () => {
  it.each(["postgresql", "mysql"] as const)(
    "drops before the kit and adds after it on %s",
    dialect => {
      const { before, after } = kitRouteConstraintStatements(
        rekey,
        [items, shelves],
        dialect
      );
      expect(before).toHaveLength(1);
      expect(before[0]).toMatch(/DROP (CONSTRAINT|CHECK)/);
      expect(after).toHaveLength(2);
      expect(after[0]).toContain("CHECK (status IN ('a', 'b'))");
      expect(after[1]).toContain("FOREIGN KEY");
    }
  );

  it("adds a kit-created table's constraints on PostgreSQL only", () => {
    const created: Operation[] = [{ type: "add_table", table: items }];
    expect(
      kitRouteConstraintStatements(created, [items], "postgresql").after
    ).toHaveLength(2);
    // MySQL created it ahead of the kit, constraints included.
    expect(
      kitRouteConstraintStatements(created, [items], "mysql").after
    ).toEqual([]);
  });

  it("leaves SQLite to the kit, whose tables carry their constraints", () => {
    expect(kitRouteConstraintStatements(rekey, [items], "sqlite")).toEqual({
      before: [],
      after: [],
    });
  });

  describe("a MySQL type change on a column a foreign key covers", () => {
    const retype = (tableName: string, columnName: string): Operation => ({
      type: "change_column_type",
      tableName,
      columnName,
      fromType: "varchar(255)",
      toType: "varchar(64)",
    });

    it.each([
      ["the key's own column", retype("cx__items", "shelf_id")],
      ["the column it references", retype("cx__shelves", "id")],
    ])("lifts the key around it: %s", (_label, op) => {
      const { before, after } = kitRouteConstraintStatements(
        [op],
        [items, shelves],
        "mysql"
      );
      expect(before).toEqual([
        expect.stringContaining("DROP FOREIGN KEY `fk_cx__items_shelf_id`"),
      ]);
      expect(after).toEqual([
        expect.stringContaining("ADD CONSTRAINT `fk_cx__items_shelf_id`"),
      ]);
    });

    it("leaves a key alone when the change is to another column", () => {
      expect(
        kitRouteConstraintStatements(
          [retype("cx__items", "id")],
          [items, shelves],
          "mysql"
        )
      ).toEqual({ before: [], after: [] });
    });

    it("does not lift it on PostgreSQL, which changes the type in place", () => {
      expect(
        kitRouteConstraintStatements(
          [retype("cx__items", "shelf_id")],
          [items, shelves],
          "postgresql"
        )
      ).toEqual({ before: [], after: [] });
    });
  });
});
