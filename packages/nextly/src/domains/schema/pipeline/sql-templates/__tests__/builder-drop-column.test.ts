/**
 * A Schema Builder ALTER generator drops a removed field's column with a statement each dialect
 * accepts. MySQL has no `DROP COLUMN IF EXISTS` (MariaDB does), and with it a removed column stayed
 * and a NOT NULL one refused every later insert; only PostgreSQL keeps `IF EXISTS`.
 */
import { describe, expect, it } from "vitest";

import { FieldGroupSchemaService } from "../../../../field-groups/services/field-group-schema-service";
import { UserExtSchemaService } from "../../../../users/services/user-ext-schema-service";
import { builderDropColumnSql } from "../common-statements";

describe("builderDropColumnSql", () => {
  it("keeps IF EXISTS on postgresql only", () => {
    expect(builderDropColumnSql("postgresql", '"t"', '"c"')).toBe(
      'ALTER TABLE "t" DROP COLUMN IF EXISTS "c";'
    );
    expect(builderDropColumnSql("mysql", "`t`", "`c`")).toBe(
      "ALTER TABLE `t` DROP COLUMN `c`;"
    );
    expect(builderDropColumnSql("sqlite", '"t"', '"c"')).toBe(
      'ALTER TABLE "t" DROP COLUMN "c";'
    );
  });
});

describe("the generators that use it, on mysql", () => {
  it("drops a removed field-group column with a statement mysql accepts", () => {
    const sql = new FieldGroupSchemaService(
      "mysql"
    ).generateAlterTableMigration(
      "comp_widget",
      [{ name: "note", type: "text" }],
      []
    );
    expect(sql).toContain("ALTER TABLE `comp_widget` DROP COLUMN `note`;");
    expect(sql).not.toMatch(/IF EXISTS/);
  });

  it("drops a removed user field's column with a statement mysql accepts", () => {
    const sql = new UserExtSchemaService("mysql").generateAlterTableMigration(
      [{ name: "note", type: "text" } as never],
      []
    );
    expect(sql).toMatch(/DROP COLUMN `note`;/);
    expect(sql).not.toMatch(/IF EXISTS/);
  });
});
