/**
 * Changing what a foreign key does to its rows, per dialect.
 *
 * No dialect can edit a referential action in place, so every implementation
 * drops the constraint and declares it again. What differs is how many
 * statements that takes and whether the dialect can do it at all.
 */
import { describe, expect, it } from "vitest";

import type { ChangeForeignKeyActionOp } from "../../diff/types";
import { generateSQL, SqliteUnsupportedOperationError } from "../index";

const op: ChangeForeignKeyActionOp = {
  type: "change_foreign_key_action",
  tableName: "dc_posts",
  constraintName: "fk_dc_posts_author_id",
  columnName: "author_id",
  referencesTable: "dc_authors",
  referencesColumn: "id",
  fromOnDelete: "CASCADE",
  fromOnUpdate: "NO ACTION",
  toOnDelete: "RESTRICT",
  toOnUpdate: "NO ACTION",
};

describe("change_foreign_key_action", () => {
  it("postgres drops and redeclares the constraint as two statements", () => {
    const sql = generateSQL(op, "postgresql");
    // Two, not one. The constraint keeps its name, and a drop and an add of
    // one name in a single ALTER would rest on the order the server applies
    // its subcommands in.
    const statements = sql.split("; ");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      'ALTER TABLE "dc_posts" DROP CONSTRAINT "fk_dc_posts_author_id"'
    );
    expect(statements[1]).toBe(
      'ALTER TABLE "dc_posts" ADD CONSTRAINT "fk_dc_posts_author_id" ' +
        'FOREIGN KEY ("author_id") REFERENCES "dc_authors"("id") ' +
        "ON DELETE RESTRICT ON UPDATE NO ACTION"
    );
  });

  it("mysql uses DROP FOREIGN KEY, and never one statement", () => {
    const sql = generateSQL(op, "mysql");
    const statements = sql.split("; ");
    expect(statements).toHaveLength(2);
    // `DROP CONSTRAINT` is accepted only from 8.0.19; `DROP FOREIGN KEY`
    // works on every supported server.
    expect(statements[0]).toBe(
      "ALTER TABLE `dc_posts` DROP FOREIGN KEY `fk_dc_posts_author_id`"
    );
    expect(statements[1]).toContain("ADD CONSTRAINT `fk_dc_posts_author_id`");
    expect(statements[1]).toContain("ON DELETE RESTRICT ON UPDATE NO ACTION");
    // One ALTER carrying both halves under the same name is MySQL bug #68286
    // (error 1826), so the two must not be combined.
    expect(sql).not.toMatch(/DROP FOREIGN KEY[^;]*ADD CONSTRAINT/);
  });

  it("sqlite refuses by name rather than rebuilding the table", () => {
    expect(() => generateSQL(op, "sqlite")).toThrow(
      SqliteUnsupportedOperationError
    );
    expect(() => generateSQL(op, "sqlite")).toThrow(
      /change_foreign_key_action/
    );
  });

  it("writes the NEW actions, and carries the old ones for the inverse", () => {
    // The `from` pair is what lets `migrate:create` write the down migration
    // as a swap; it must never reach the emitted SQL.
    const sql = generateSQL(op, "postgresql");
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).not.toContain("CASCADE");
  });
});
