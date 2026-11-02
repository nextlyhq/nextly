import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "../../../../../cli/commands/migrate";
import { generateMysqlSQL } from "../mysql";
import { generatePgSQL } from "../postgres";
import { generateSqliteSQL } from "../sqlite";

const addUnique = {
  type: "add_index" as const,
  tableName: "dc_x",
  index: { name: "uq_dc_x_email", columns: ["email"], unique: true },
};
const dropPlain = {
  type: "drop_index" as const,
  tableName: "dc_x",
  index: { name: "idx_dc_x_views", columns: ["views"], unique: false },
};

describe("postgres index SQL", () => {
  it("emits CREATE UNIQUE INDEX IF NOT EXISTS for add_index", () => {
    const sql = generatePgSQL(addUnique);
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_x_email"');
    expect(sql).toContain('ON "dc_x" ("email")');
  });
  it("emits DROP INDEX IF EXISTS for drop_index", () => {
    expect(generatePgSQL(dropPlain)).toContain(
      'DROP INDEX IF EXISTS "idx_dc_x_views"'
    );
  });
  it("drops the owning constraint too when the index is unique", () => {
    // A `unique: true` field created by the schema services exists as
    // ALTER TABLE ... ADD CONSTRAINT, whose index Postgres refuses to DROP
    // INDEX ("constraint ... requires it") — IF EXISTS does not suppress
    // that. Both idempotent drops must run so either physical form is
    // removed.
    const sql = generatePgSQL({
      type: "drop_index",
      tableName: "dc_x",
      index: { name: "uq_dc_x_email", columns: ["email"], unique: true },
    } as never);
    expect(sql).toContain(
      'ALTER TABLE "dc_x" DROP CONSTRAINT IF EXISTS "uq_dc_x_email"'
    );
    expect(sql).toContain('DROP INDEX IF EXISTS "uq_dc_x_email"');
    // The constraint must go first: dropping it removes the index it owns.
    expect(sql.indexOf("DROP CONSTRAINT")).toBeLessThan(
      sql.indexOf("DROP INDEX")
    );
  });
  it("keeps the plain form for a non-unique index (never constraint-owned)", () => {
    expect(generatePgSQL(dropPlain)).not.toContain("DROP CONSTRAINT");
  });
  it("survives the migration runner's statement splitter", () => {
    // This SQL is written verbatim into migrate:create files, and the runner
    // splits a file on semicolons outside quotes — it does not understand
    // dollar-quoting, so a DO block here would be cut into unterminated
    // fragments that fail at apply time. Both halves must come back whole.
    const sql = generatePgSQL({
      type: "drop_index",
      tableName: "dc_x",
      index: { name: "uq_dc_x_email", columns: ["email"], unique: true },
    } as never);

    const statements = splitSqlStatements(`${sql};`);

    expect(statements).toEqual([
      'ALTER TABLE "dc_x" DROP CONSTRAINT IF EXISTS "uq_dc_x_email"',
      'DROP INDEX IF EXISTS "uq_dc_x_email"',
    ]);
  });
  it("renders table indexes on add_table", () => {
    const sql = generatePgSQL({
      type: "add_table",
      table: {
        name: "dc_x",
        columns: [{ name: "id", type: "text", nullable: false }],
        indexes: [{ name: "idx_dc_x_slug", columns: ["slug"], unique: true }],
      },
    } as never);
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_x_slug"');
  });
});

describe("mysql index SQL", () => {
  it("emits CREATE UNIQUE INDEX and DROP INDEX ... ON", () => {
    expect(generateMysqlSQL(addUnique)).toContain(
      "CREATE UNIQUE INDEX `uq_dc_x_email`"
    );
    expect(generateMysqlSQL(dropPlain)).toContain(
      "DROP INDEX `idx_dc_x_views` ON `dc_x`"
    );
  });
});

describe("sqlite index SQL", () => {
  it("emits CREATE UNIQUE INDEX IF NOT EXISTS and DROP INDEX IF EXISTS", () => {
    expect(generateSqliteSQL(addUnique)).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_x_email"'
    );
    expect(generateSqliteSQL(dropPlain)).toContain(
      'DROP INDEX IF EXISTS "idx_dc_x_views"'
    );
  });
});
