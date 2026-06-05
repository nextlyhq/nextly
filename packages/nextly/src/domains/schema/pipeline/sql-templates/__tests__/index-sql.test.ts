import { describe, expect, it } from "vitest";

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
    expect(generatePgSQL(dropPlain)).toContain('DROP INDEX IF EXISTS "idx_dc_x_views"');
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
    expect(generateMysqlSQL(addUnique)).toContain("CREATE UNIQUE INDEX `uq_dc_x_email`");
    expect(generateMysqlSQL(dropPlain)).toContain("DROP INDEX `idx_dc_x_views` ON `dc_x`");
  });
});

describe("sqlite index SQL", () => {
  it("emits CREATE UNIQUE INDEX IF NOT EXISTS and DROP INDEX IF EXISTS", () => {
    expect(generateSqliteSQL(addUnique)).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_x_email"');
    expect(generateSqliteSQL(dropPlain)).toContain('DROP INDEX IF EXISTS "idx_dc_x_views"');
  });
});
