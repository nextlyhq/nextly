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
import type { CheckSpec, ForeignKeySpec, TableSpec } from "../types";
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
      {
        tables: [
          tableWith([check("ck_orders_status", `status IN ('open','paid')`)]),
        ],
      }
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
      {
        type: "drop_check",
        tableName: "fx__orders",
        check: check("ck_old", "score >= 0"),
      },
    ]);
  });

  it("changes a check's expression as drop-plus-add under the same name", () => {
    const ops = diffSnapshots(
      {
        tables: [tableWith([check("ck_orders_status", `status IN ('open')`)])],
      },
      {
        tables: [
          tableWith([check("ck_orders_status", `status IN ('open','paid')`)]),
        ],
      }
    );
    expect(ops.map(op => op.type)).toEqual(["drop_check", "add_check"]);
  });

  it("reads PostgreSQL's spelling of a check as the check it was declared as", () => {
    // The live side is what pg_get_constraintdef reports for an enum check on
    // a varchar column; the desired side is what `col.enum()` declares. Compared
    // as text these never match, so every comparison proposed a drop-plus-add.
    const live = check(
      "ck_orders_status",
      "((status)::text = ANY ((ARRAY['open'::character varying, 'paid'::character varying])::text[]))"
    );
    const declared = check("ck_orders_status", "status IN ('open', 'paid')");
    expect(
      diffSnapshots(
        { tables: [tableWith([live])] },
        { tables: [tableWith([declared])] }
      )
    ).toEqual([]);
  });

  it("still changes a check PostgreSQL reports when the declaration differs", () => {
    // The control for the case above: canonical comparison must not swallow a
    // real change. The ops carry each side's own text, not the canonical form.
    const live = check(
      "ck_orders_status",
      "((status)::text = ANY ((ARRAY['open'::character varying, 'paid'::character varying])::text[]))"
    );
    const declared = check(
      "ck_orders_status",
      "status IN ('open', 'paid', 'void')"
    );
    expect(
      diffSnapshots(
        { tables: [tableWith([live])] },
        { tables: [tableWith([declared])] }
      )
    ).toEqual([
      { type: "drop_check", tableName: "fx__orders", check: live },
      { type: "add_check", tableName: "fx__orders", check: declared },
    ]);
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
    const drop = {
      type: "drop_check",
      tableName: op.tableName,
      check: op.check,
    } as const;
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

describe("diffForeignKeys", () => {
  const fk = (
    name: string,
    over: Partial<ForeignKeySpec> = {}
  ): ForeignKeySpec =>
    ({
      name,
      columns: ["author_id"],
      referencesTable: "dc_authors",
      referencesColumns: ["id"],
      onDelete: "cascade",
      onUpdate: "no action",
      ...over,
    }) as never;
  const tableWithFks = (fks: unknown[] | undefined) => ({
    ...tableWith([]),
    checks: [],
    foreignKeys: fks as never,
  });

  it("adds a foreign key the previous snapshot did not carry", () => {
    const ops = diffSnapshots(
      { tables: [tableWithFks([])] },
      { tables: [tableWithFks([fk("fk_dc_a_author_id")])] }
    );
    expect(ops.map(op => op.type)).toEqual(["add_foreign_key"]);
  });

  it("changes a foreign key's shape as drop-then-add under the same name", () => {
    const ops = diffSnapshots(
      { tables: [tableWithFks([fk("fk_x", { onDelete: "restrict" })])] },
      { tables: [tableWithFks([fk("fk_x")])] }
    );
    expect(ops.map(op => op.type)).toEqual([
      "drop_foreign_key",
      "add_foreign_key",
    ]);
  });

  it("keeps an identical foreign key and drops a removed one", () => {
    const ops = diffSnapshots(
      { tables: [tableWithFks([fk("fk_keep"), fk("fk_gone")])] },
      { tables: [tableWithFks([fk("fk_keep")])] }
    );
    expect(ops.map(op => op.type)).toEqual(["drop_foreign_key"]);
  });

  it("emits nothing when either side did not track foreign keys", () => {
    expect(
      diffSnapshots(
        { tables: [tableWithFks(undefined)] },
        { tables: [tableWithFks([fk("fk_x")])] }
      )
    ).toEqual([]);
  });

  it("renders ADD/DROP with the dialect's own verb and inverts in the down", () => {
    const op = {
      type: "add_foreign_key",
      tableName: "fx__notes",
      foreignKey: fk("fk_fx__notes_user", {
        columns: ["user_id"],
        referencesTable: "users",
      }),
    } as never;
    expect(generateSQL(op, "postgresql")).toBe(
      'ALTER TABLE "fx__notes" ADD CONSTRAINT "fk_fx__notes_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION'
    );
    expect(generateSQL(op, "mysql")).toBe(
      "ALTER TABLE `fx__notes` ADD CONSTRAINT `fk_fx__notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION"
    );
    expect(() => generateSQL(op, "sqlite")).toThrow();
    const inverse = buildInverseOperations([op], { tables: [] });
    expect(inverse.map(o => (o as { type: string }).type)).toEqual([
      "drop_foreign_key",
    ]);
  });
});

describe("partial and expression indexes", () => {
  const base = {
    name: "idx_fx__orders_open",
    columns: ["status"],
    unique: false,
  };

  it("renders the WHERE predicate on postgres and sqlite", () => {
    const op = {
      type: "add_index",
      tableName: "fx__orders",
      index: { ...base, where: "status = 'open'" },
    } as never;
    expect(generateSQL(op, "postgresql")).toBe(
      `CREATE INDEX IF NOT EXISTS "idx_fx__orders_open" ON "fx__orders" ("status") WHERE status = 'open'`
    );
    expect(generateSQL(op, "sqlite")).toBe(
      `CREATE INDEX IF NOT EXISTS "idx_fx__orders_open" ON "fx__orders" ("status") WHERE status = 'open'`
    );
  });

  it("refuses a partial index on mysql, which has none", () => {
    const op = {
      type: "add_index",
      tableName: "fx__orders",
      index: { ...base, where: "status = 'open'" },
    } as never;
    expect(() => generateSQL(op, "mysql")).toThrow();
  });

  it("renders an expression index per dialect", () => {
    const op = {
      type: "add_index",
      tableName: "fx__orders",
      index: { ...base, columns: [], expression: "lower(email)" },
    } as never;
    expect(generateSQL(op, "postgresql")).toBe(
      `CREATE INDEX IF NOT EXISTS "idx_fx__orders_open" ON "fx__orders" ((lower(email)))`
    );
    // MySQL takes a functional key part only parenthesised: `(lower(email))`
    // as the whole key list is a syntax error there (ER_PARSE_ERROR, measured
    // on 8.0.46), so the expression carries its own parentheses as on PG.
    expect(generateSQL(op, "mysql")).toBe(
      "CREATE INDEX `idx_fx__orders_open` ON `fx__orders` ((lower(email)))"
    );
  });

  it("a changed predicate re-keys the index, arriving as drop-plus-add", () => {
    const prev = {
      ...tableWith([]),
      indexes: [{ ...base, where: "status = 'open'" }],
    };
    const cur = {
      ...tableWith([]),
      indexes: [{ ...base, where: "status <> 'done'" }],
    };
    const ops = diffSnapshots({ tables: [prev] }, { tables: [cur] });
    expect(ops.map(op => op.type)).toEqual(["drop_index", "add_index"]);
  });
});
