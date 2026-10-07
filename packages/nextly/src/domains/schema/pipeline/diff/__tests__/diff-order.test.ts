/**
 * The order the diff plans tables and constraints in.
 *
 * PostgreSQL and MySQL refuse a foreign key to a table that does not exist
 * yet, refuse to drop a table another still references, and MySQL refuses to
 * drop or retype a column a key or check still names. So the order is part of
 * correctness, for the forward operations and for their inverse, which the
 * down migration runs in reverse.
 */
import { describe, expect, it } from "vitest";

import { buildInverseOperations } from "../../../migrate-create/down-generator";
import { diffSnapshots } from "../diff";
import type { ForeignKeySpec, Operation, TableSpec } from "../types";

const EMPTY = { tables: [] };

function table(name: string, references: string[] = []): TableSpec {
  return {
    name,
    columns: [
      { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
      ...references.map(target => ({
        name: `${target}_id`,
        type: "varchar(36)",
        nullable: true,
      })),
    ],
    indexes: [],
    foreignKeys: references.map(target => key(name, `${target}_id`, target)),
  };
}

function key(
  tableName: string,
  column: string,
  target: string
): ForeignKeySpec {
  return {
    name: `fk_${tableName}_${column}`,
    columns: [column],
    referencesTable: target,
    referencesColumns: ["id"],
    onDelete: "no action",
    onUpdate: "no action",
  };
}

const tableOrder = (ops: Operation[]) =>
  ops.flatMap(op =>
    op.type === "add_table"
      ? [`add ${op.table.name}`]
      : op.type === "drop_table"
        ? [`drop ${op.tableName}`]
        : []
  );

describe("diffSnapshots — table order", () => {
  // Name order would put a_child first; its key points at z_parent.
  const tables = [
    table("a_child", ["z_parent"]),
    table("z_parent"),
    table("m_other"),
  ];

  it("creates a table after the tables it references", () => {
    expect(tableOrder(diffSnapshots(EMPTY, { tables }))).toEqual([
      "add z_parent",
      "add a_child",
      "add m_other",
    ]);
  });

  it("drops a table before the tables it referenced", () => {
    expect(tableOrder(diffSnapshots({ tables }, EMPTY))).toEqual([
      "drop m_other",
      "drop a_child",
      "drop z_parent",
    ]);
  });

  it("keeps the down migration in dependency order too", () => {
    const up = diffSnapshots(EMPTY, { tables });
    expect(tableOrder(buildInverseOperations(up, EMPTY))).toEqual([
      "drop m_other",
      "drop a_child",
      "drop z_parent",
    ]);
  });

  it("orders a chain transitively, and ignores a reference to an existing table", () => {
    const chain = [table("a", ["b"]), table("b", ["c"]), table("c", ["users"])];
    expect(tableOrder(diffSnapshots(EMPTY, { tables: chain }))).toEqual([
      "add c",
      "add b",
      "add a",
    ]);
  });

  it("orders a cycle deterministically, from the first table by name", () => {
    const cycle = [table("b", ["a"]), table("a", ["b"])];
    expect(tableOrder(diffSnapshots(EMPTY, { tables: cycle }))).toEqual([
      "add b",
      "add a",
    ]);
  });
});

describe("diffSnapshots — constraint drops", () => {
  const withLegacy: TableSpec = {
    name: "parts",
    columns: [
      { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
      { name: "legacy_bin_id", type: "varchar(36)", nullable: true },
    ],
    indexes: [],
    foreignKeys: [key("parts", "legacy_bin_id", "bins")],
    checks: [{ name: "ck_parts_legacy", sql: "legacy_bin_id <> ''" }],
  };
  const without: TableSpec = {
    ...withLegacy,
    columns: [withLegacy.columns[0]],
    foreignKeys: [],
    checks: [],
  };

  it("drops a key and a check before the column they name", () => {
    const kinds = diffSnapshots(
      { tables: [withLegacy] },
      { tables: [without] }
    ).map(op => op.type);
    const column = kinds.indexOf("drop_column");
    expect(column).toBeGreaterThan(-1);
    expect(kinds.indexOf("drop_foreign_key")).toBeLessThan(column);
    expect(kinds.indexOf("drop_check")).toBeLessThan(column);
  });

  it("re-creates the column before the key and check on the way down", () => {
    const up = diffSnapshots({ tables: [withLegacy] }, { tables: [without] });
    const kinds = buildInverseOperations(up, { tables: [withLegacy] }).map(
      op => op.type
    );
    const column = kinds.indexOf("add_column");
    expect(column).toBeGreaterThan(-1);
    expect(kinds.indexOf("add_foreign_key")).toBeGreaterThan(column);
    expect(kinds.indexOf("add_check")).toBeGreaterThan(column);
  });

  it("still runs a re-keyed check as drop then add", () => {
    const rekeyed: TableSpec = {
      ...withLegacy,
      checks: [{ name: "ck_parts_legacy", sql: "legacy_bin_id <> 'x'" }],
    };
    const kinds = diffSnapshots({ tables: [withLegacy] }, { tables: [rekeyed] })
      .map(op => op.type)
      .filter(kind => kind.endsWith("_check"));
    expect(kinds).toEqual(["drop_check", "add_check"]);
  });

  describe("a surviving table's key to a table dropped with it", () => {
    const orders: TableSpec = {
      ...table("orders", ["carts"]),
    };
    const carts = table("carts");
    const before = { tables: [orders, carts] };
    const after = {
      tables: [
        {
          ...orders,
          columns: orders.columns.filter(column => column.name !== "carts_id"),
          foreignKeys: [],
        },
      ],
    };

    it("drops the key before the table it points at", () => {
      const kinds = diffSnapshots(before, after).map(op =>
        op.type === "drop_table" ? `drop_table ${op.tableName}` : op.type
      );
      expect(kinds.indexOf("drop_foreign_key")).toBeLessThan(
        kinds.indexOf("drop_table carts")
      );
    });

    it("re-adds the key after re-creating that table on the way down", () => {
      const up = diffSnapshots(before, after);
      const kinds = buildInverseOperations(up, before).map(op =>
        op.type === "add_table" ? `add_table ${op.table.name}` : op.type
      );
      expect(kinds.indexOf("add_foreign_key")).toBeGreaterThan(
        kinds.indexOf("add_table carts")
      );
    });
  });
});
