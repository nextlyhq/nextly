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
  it("drops before the kit and adds after it on postgresql", () => {
    const { before, after } = kitRouteConstraintStatements(
      rekey,
      [items, shelves],
      "postgresql"
    );
    expect(before).toHaveLength(1);
    expect(before[0]).toMatch(/DROP CONSTRAINT/);
    expect(after).toHaveLength(2);
    expect(after[0]).toContain("CHECK (status IN ('a', 'b'))");
    expect(after[1]).toContain("FOREIGN KEY");
  });

  it("replaces a check atomically in one ALTER TABLE after the kit on mysql", () => {
    const { before, after } = kitRouteConstraintStatements(
      rekey,
      [items, shelves],
      "mysql"
    );
    expect(before).toEqual([]);
    expect(after).toEqual([
      "ALTER TABLE `cx__items` DROP CHECK `ck_cx__items_status_enum`, ADD CONSTRAINT `ck_cx__items_status_enum` CHECK (status IN ('a', 'b'))",
      expect.stringContaining("FOREIGN KEY"),
    ]);
  });

  it("replaces a renamed enum check atomically on mysql when the column is unchanged", () => {
    const renamed: Operation[] = [
      {
        type: "drop_check",
        tableName: "cx__items",
        check: { name: "ck_old", sql: "`status` IN ('a', 'b')" },
      },
      {
        type: "add_check",
        tableName: "cx__items",
        check: { name: "ck_new", sql: "`status` IN ('a')" },
      },
    ];
    expect(kitRouteConstraintStatements(renamed, [items], "mysql")).toEqual({
      before: [],
      after: [
        "ALTER TABLE `cx__items` DROP CHECK `ck_old`, ADD CONSTRAINT `ck_new` CHECK (`status` IN ('a'))",
      ],
      liftRestores: [],
    });
  });

  it("keeps drop_check before the kit on mysql when the constrained column is altered", () => {
    const withTypeChange: Operation[] = [
      ...rekey,
      {
        type: "change_column_type",
        tableName: "cx__items",
        columnName: "status",
        fromType: "varchar(64)",
        toType: "text",
      },
    ];
    const { before, after } = kitRouteConstraintStatements(
      withTypeChange,
      [items, shelves],
      "mysql"
    );
    expect(before).toEqual([
      "ALTER TABLE `cx__items` DROP CHECK `ck_cx__items_status_enum`",
    ]);
    expect(after[0]).toContain("ADD CONSTRAINT `ck_cx__items_status_enum`");
  });

  it("replaces a non-enum check atomically on mysql by name unless a column on the table changes", () => {
    const plain: Operation[] = [
      {
        type: "drop_check",
        tableName: "cx__items",
        check: { name: "ck_qty", sql: "quantity >= 0" },
      },
      {
        type: "add_check",
        tableName: "cx__items",
        check: { name: "ck_qty", sql: "quantity >= 10" },
      },
    ];
    expect(kitRouteConstraintStatements(plain, [items], "mysql")).toEqual({
      before: [],
      after: [
        "ALTER TABLE `cx__items` DROP CHECK `ck_qty`, ADD CONSTRAINT `ck_qty` CHECK (quantity >= 10)",
      ],
      liftRestores: [],
    });

    const withRenamedColumn = kitRouteConstraintStatements(
      [
        ...plain,
        {
          type: "rename_column",
          tableName: "cx__items",
          fromColumn: "qty",
          toColumn: "quantity",
          fromType: "integer",
          toType: "integer",
        },
      ],
      [items],
      "mysql"
    );
    expect(withRenamedColumn.before).toEqual([
      "ALTER TABLE `cx__items` DROP CHECK `ck_qty`",
    ]);
    expect(withRenamedColumn.after).toEqual([
      "ALTER TABLE `cx__items` ADD CONSTRAINT `ck_qty` CHECK (quantity >= 10)",
    ]);
  });

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
      liftRestores: [],
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

    it("names the lifted key's restore apart, for a failed apply to put back", () => {
      // Only a key this apply LIFTED is owed back when the apply fails part way: it existed before
      // the apply dropped it. A key the apply ADDS is not, so it is not among them.
      const { liftRestores } = kitRouteConstraintStatements(
        [retype("cx__items", "shelf_id")],
        [items, shelves],
        "mysql"
      );
      expect(liftRestores).toEqual([
        expect.stringContaining("ADD CONSTRAINT `fk_cx__items_shelf_id`"),
      ]);
      const added = kitRouteConstraintStatements(
        [
          retype("cx__items", "shelf_id"),
          {
            type: "add_foreign_key",
            tableName: "cx__items",
            foreignKey: shelfKey,
          },
        ],
        [{ ...items, foreignKeys: [] }, shelves],
        "mysql"
      );
      expect(added.liftRestores).toEqual([]);
    });

    it("never drops a key this apply adds, and adds it once", () => {
      // The key is new: absent from the live schema, planned as an add.
      const liveWithoutKey: TableSpec = { ...items, foreignKeys: [] };
      const { before, after } = kitRouteConstraintStatements(
        [
          retype("cx__items", "shelf_id"),
          {
            type: "add_foreign_key",
            tableName: "cx__items",
            foreignKey: shelfKey,
          },
        ],
        [liveWithoutKey, shelves],
        "mysql"
      );
      expect(before).toEqual([]);
      expect(after).toEqual([
        expect.stringContaining("ADD CONSTRAINT `fk_cx__items_shelf_id`"),
      ]);
    });

    it("leaves a re-keyed key to its own drop and add", () => {
      const rekeyed: ForeignKeySpec = { ...shelfKey, onDelete: "cascade" };
      const { before, after } = kitRouteConstraintStatements(
        [
          retype("cx__items", "shelf_id"),
          {
            type: "drop_foreign_key",
            tableName: "cx__items",
            foreignKey: shelfKey,
          },
          {
            type: "add_foreign_key",
            tableName: "cx__items",
            foreignKey: rekeyed,
          },
        ],
        [items, shelves],
        "mysql"
      );
      expect(before).toHaveLength(1);
      expect(after).toEqual([expect.stringContaining("ON DELETE CASCADE")]);
    });

    it("does not lift a key that will not survive the apply", () => {
      // Its table is dropped, or the column it covers is.
      for (const gone of [
        { type: "drop_table", tableName: "cx__items" } as const,
        {
          type: "drop_column",
          tableName: "cx__items",
          columnName: "shelf_id",
          columnType: "varchar(36)",
        } as const,
      ]) {
        expect(
          kitRouteConstraintStatements(
            [retype("cx__shelves", "id"), gone],
            [items, shelves],
            "mysql"
          )
        ).toEqual({ before: [], after: [], liftRestores: [] });
      }
    });

    it("leaves a key alone when the change is to another column", () => {
      expect(
        kitRouteConstraintStatements(
          [retype("cx__items", "id")],
          [items, shelves],
          "mysql"
        )
      ).toEqual({ before: [], after: [], liftRestores: [] });
    });

    it("does not lift it on PostgreSQL, which changes the type in place", () => {
      expect(
        kitRouteConstraintStatements(
          [retype("cx__items", "shelf_id")],
          [items, shelves],
          "postgresql"
        )
      ).toEqual({ before: [], after: [], liftRestores: [] });
    });
  });
});
