// A new table's checks and foreign keys, as the dev-push emitter creates them.
//
// The integration suite asks the database whether they are enforced; this pins
// WHERE each dialect declares them, which is the part a plausible regression
// gets wrong: a foreign key emitted beside its own CREATE TABLE fails on
// PostgreSQL and MySQL when the table it points at comes later in the batch.

import { describe, expect, it } from "vitest";

import type { Operation, TableSpec } from "../../diff/types";
import { emitDdl } from "../index";

const items: TableSpec = {
  name: "ck__items",
  columns: [
    { name: "id", type: "text", nullable: false, primaryKey: true },
    { name: "quantity", type: "integer", nullable: false },
    { name: "shelf_id", type: "text", nullable: false },
  ],
  indexes: [],
  checks: [{ name: "ck_ck__items_quantity", sql: "quantity >= 0" }],
  foreignKeys: [
    {
      name: "fk_ck__items_shelf_id",
      columns: ["shelf_id"],
      referencesTable: "ck__shelves",
      referencesColumns: ["id"],
      onDelete: "no action",
      onUpdate: "no action",
    },
  ],
};
const shelves: TableSpec = {
  name: "ck__shelves",
  columns: [{ name: "id", type: "text", nullable: false, primaryKey: true }],
  indexes: [],
};
// The diff's order: by name, so the referencing table comes first.
const ops: Operation[] = [
  { type: "add_table", table: items },
  { type: "add_table", table: shelves },
];

describe("emitDdl — a new table's checks and foreign keys", () => {
  it("declares them inside CREATE TABLE on SQLite, the only place it accepts them", () => {
    const statements = emitDdl(ops, "sqlite");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^CREATE TABLE "ck__items"/);
    expect(statements[0]).toContain(
      'CONSTRAINT "ck_ck__items_quantity" CHECK (quantity >= 0)'
    );
    expect(statements[0]).toContain(
      'CONSTRAINT "fk_ck__items_shelf_id" FOREIGN KEY ("shelf_id") REFERENCES "ck__shelves" ("id")'
    );
  });

  it.each(["postgresql", "mysql"] as const)(
    "adds them on %s after every table of the apply exists",
    dialect => {
      const statements = emitDdl(ops, dialect);
      const creates = statements.filter(s => s.startsWith("CREATE TABLE"));
      const constraints = statements.filter(s => s.includes("ADD CONSTRAINT"));
      expect(creates).toHaveLength(2);
      expect(constraints).toHaveLength(2);
      // Neither CREATE carries a constraint of its own.
      for (const create of creates) expect(create).not.toContain("CONSTRAINT");
      // Checks first, then foreign keys, and all of them after the last CREATE.
      const lastCreate = statements.lastIndexOf(creates[1]);
      expect(statements.indexOf(constraints[0])).toBeGreaterThan(lastCreate);
      expect(constraints[0]).toContain("CHECK (quantity >= 0)");
      expect(constraints[1]).toContain("FOREIGN KEY");
    }
  );

  it("adds nothing for a table that declares neither", () => {
    expect(
      emitDdl([{ type: "add_table", table: shelves }], "postgresql").some(s =>
        s.includes("CONSTRAINT")
      )
    ).toBe(false);
  });
});
