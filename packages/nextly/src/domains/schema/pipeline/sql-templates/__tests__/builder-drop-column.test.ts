/**
 * A Schema Builder ALTER generator drops a removed field's column with a statement each dialect
 * accepts. MySQL has no `DROP COLUMN IF EXISTS` (MariaDB does), and with it a removed column stayed
 * and a NOT NULL one refused every later insert; only PostgreSQL keeps `IF EXISTS`. The collection
 * generator's MySQL output is pinned in `alter-column-attachments.test.ts`.
 */
import { describe, expect, it } from "vitest";

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
