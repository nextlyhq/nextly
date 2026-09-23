/**
 * Check constraints through the diff and the renderers.
 *
 * A changed expression must arrive as drop-plus-add under the same name —
 * that shape is what every dialect can execute — and an untracked snapshot
 * side must produce nothing, so pre-check snapshots never look like "this
 * table's checks were all removed".
 */
import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import type { CheckSpec, TableSpec } from "../types";
import { generateSQL } from "../../sql-templates/index";
import { buildInverseOperations } from "../../../migrate-create/down-generator";

function tableWith(checks: CheckSpec[] | undefined): TableSpec {
  return {
    name: "fx__orders",
    columns: [{ name: "id", type: "varchar(36)", nullable: false }],
    indexes: [],
    checks,
  };
}

const check = (name: string, sql: string): CheckSpec => ({ name, sql });

describe("diffChecks", () => {
  it("adds a check the previous snapshot did not carry", () => {
    const ops = diffSnapshots(
      { tables: [tableWith([])] },
      { tables: [tableWith([check("ck_orders_status", `status IN ('open','paid')`)])] }
    );
    expect(ops).toEqual([
      {
        type: "add_check",
        tableName: "fx__orders",
        check: check("ck_orders_status", `status IN ('open','paid')`),
      },
    ]);
  });

  it("drops a check the new snapshot removed", () => {
    const ops = diffSnapshots(
      { tables: [tableWith([check("ck_old", "score >= 0")])] },
      { tables: [tableWith([])] }
    );
    expect(ops).toEqual([
      { type: "drop_check", tableName: "fx__orders", check: check("ck_old", "score >= 0") },
    ]);
  });

  it("changes a check's expression as drop-plus-add under the same name", () => {
    const ops = diffSnapshots(
      { tables: [tableWith([check("ck_orders_status", `status IN ('open')`)])] },
      { tables: [tableWith([check("ck_orders_status", `status IN ('open','paid')`)])] }
    );
    expect(ops.map(op => op.type)).toEqual(["drop_check", "add_check"]);
  });

  it("emits nothing when either side did not track checks", () => {
    const spec = tableWith(undefined);
    expect(
      diffSnapshots(
        { tables: [spec] },
        { tables: [tableWith([check("ck_x", "1 = 1")])] }
      )
    ).toEqual([]);
    expect(
      diffSnapshots(
        { tables: [tableWith([check("ck_x", "1 = 1")])] },
        { tables: [spec] }
      )
    ).toEqual([]);
  });
});

describe("check rendering", () => {
  const op = {
    type: "add_check",
    tableName: "fx__orders",
    check: check("ck_orders_status", `status IN ('open','paid')`),
  } as const;

  it("renders ALTER ... ADD CONSTRAINT on postgres and mysql", () => {
    expect(generateSQL(op, "postgresql")).toBe(
      `ALTER TABLE "fx__orders" ADD CONSTRAINT "ck_orders_status" CHECK (status IN ('open','paid'))`
    );
    expect(generateSQL(op, "mysql")).toBe(
      "ALTER TABLE `fx__orders` ADD CONSTRAINT `ck_orders_status` CHECK (status IN ('open','paid'))"
    );
  });

  it("drops with the dialect's own verb", () => {
    const drop = { type: "drop_check", tableName: op.tableName, check: op.check } as const;
    expect(generateSQL(drop, "postgresql")).toBe(
      `ALTER TABLE "fx__orders" DROP CONSTRAINT IF EXISTS "ck_orders_status"`
    );
    expect(generateSQL(drop, "mysql")).toBe(
      "ALTER TABLE `fx__orders` DROP CHECK `ck_orders_status`"
    );
  });

  it("refuses in-place check DDL on sqlite, as it refuses other in-place constraint edits", () => {
    expect(() => generateSQL(op, "sqlite")).toThrow();
  });

  it("inverts: add's down is the drop and vice versa", () => {
    const inverse = buildInverseOperations([op as never], { tables: [] });
    expect(inverse).toEqual([
      { type: "drop_check", tableName: "fx__orders", check: op.check },
    ]);
  });
});
