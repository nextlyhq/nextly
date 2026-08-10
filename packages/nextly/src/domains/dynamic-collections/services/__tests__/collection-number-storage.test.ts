// What column a number field reaches, for each of the three ways one can ask.
//
// A number is not one column. `dbType: "decimal"` asks for EXACT fixed point, which is what a price
// needs: a whole-number column silently discards the fraction entirely. `options.format === "float"`
// asks for an ordinary fractional number. Silence asks for whole numbers.
//
// Pinned per dialect because the storage differs per dialect, and pinned on BOTH the create path and
// the ADD COLUMN path because those are separate code: a field can reach the right column when its
// table is created and the wrong one when it is added to a table that already exists, and the column
// that results is the one the runtime has to read through.

import { afterEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";

const TABLE = "dc_number_storage";

// A registered type leaks into every later file in the run, and this one deliberately registers a
// number-storage type that would change what other suites measure.
afterEach(() => {
  clearFieldTypes();
});

function createdColumn(dialect: Dialect, field: FieldDefinition): string {
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateMigrationSQL(TABLE, [field], {});
  const line = sql
    .split("\n")
    .find(
      l => l.includes(`"${field.name}"`) || l.includes(`\`${field.name}\``)
    );
  return (line ?? "").trim();
}

function addedColumn(dialect: Dialect, field: FieldDefinition): string {
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateAlterTableMigration(TABLE, [], [field], { tableHasRows: false });
  const line = sql.split("\n").find(l => /ADD COLUMN/i.test(l));
  return (line ?? "").trim();
}

const money = (name: string): FieldDefinition =>
  ({
    name,
    type: "number",
    dbType: "decimal",
    precision: 12,
    scale: 4,
  }) as unknown as FieldDefinition;

describe("a number field's storage", () => {
  // The defect this pins: `dbType` was never read on this path, so a price column was created as a
  // whole number and every fractional amount written to it was lost.
  it.each([
    ["postgresql", "numeric(12, 4)"],
    ["mysql", "decimal(12,4)"],
    ["sqlite", "numeric"],
  ] as const)(
    "gives an exact-decimal field an exact column on %s",
    (dialect, expected) => {
      expect(createdColumn(dialect, money("price"))).toContain(expected);
    }
  );

  it.each([
    ["postgresql", "numeric(12, 4)"],
    ["mysql", "decimal(12,4)"],
    ["sqlite", "numeric"],
  ] as const)(
    "gives it the same column when it is ADDED to an existing table on %s",
    (dialect, expected) => {
      expect(addedColumn(dialect, money("price"))).toContain(expected);
    }
  );

  // Stated so the exact cases above cannot be satisfied by making every number a decimal.
  it("still gives a plain number a whole-number column", () => {
    const field = {
      name: "views",
      type: "number",
    } as unknown as FieldDefinition;

    expect(createdColumn("postgresql", field)).toContain("integer");
    expect(createdColumn("postgresql", field)).not.toContain("numeric");
  });

  // `precision` and `scale` are what let the column hold the values the field promises, so a default
  // that silently ignored them would pass every assertion above that names no dimensions.
  it("defaults an exact-decimal field that states no dimensions", () => {
    const field = {
      name: "amount",
      type: "number",
      dbType: "decimal",
    } as unknown as FieldDefinition;

    expect(createdColumn("postgresql", field)).toContain("numeric(10, 2)");
  });
});

describe("an edit that changes a number's storage", () => {
  const svc = (d: Dialect = "postgresql") =>
    new DynamicCollectionSchemaService(undefined, d);

  const plain = { name: "price", type: "number" } as unknown as FieldDefinition;

  // The defect: the modification check listed the properties it compared, and none of the four that
  // decide a number's storage were on that list. A field switched to exact decimal therefore
  // produced no ALTER, so the registry described a decimal over an integer column.
  it("notices a field switched to an exact decimal", () => {
    expect(svc().isFieldModified(plain, money("price"))).toBe(true);
  });

  it("notices a precision change on a field that is already decimal", () => {
    const before = {
      name: "price",
      type: "number",
      dbType: "decimal",
      precision: 10,
      scale: 2,
    } as unknown as FieldDefinition;

    expect(svc().isFieldModified(before, money("price"))).toBe(true);
  });

  // Stated so the cases above cannot be satisfied by reporting every field as modified, which would
  // rewrite columns on every save.
  it("still reports an unchanged field as unchanged", () => {
    expect(svc().isFieldModified(plain, { ...plain })).toBe(false);
    expect(svc().isFieldModified(money("price"), money("price"))).toBe(false);
  });
});

describe("decimal dimensions that cannot safely become SQL", () => {
  // These arrive from a request payload on the Builder path, which validates names and plugin
  // options but not these. Unchecked, the value is interpolated into the type verbatim.
  const generate = (field: FieldDefinition): string =>
    new DynamicCollectionSchemaService(
      undefined,
      "postgresql"
    ).generateMigrationSQL(TABLE, [field], {});

  it.each([
    ["a non-integer precision", { precision: 2.5, scale: 1 }],
    ["a scale larger than the precision", { precision: 2, scale: 8 }],
    ["a precision out of range", { precision: 0, scale: 0 }],
  ])("refuses %s", (_label, dims) => {
    const field = {
      name: "price",
      type: "number",
      dbType: "decimal",
      ...dims,
    } as unknown as FieldDefinition;

    expect(() => generate(field)).toThrow();
  });

  it("accepts dimensions that are usable", () => {
    expect(() => generate(money("price"))).not.toThrow();
  });
});

/**
 * The statement that CHANGES an existing column, which is a third path with its own answer.
 *
 * Detecting that a column must change and rendering what it becomes are two questions, and they were
 * answered by different code: the comparison reads the descriptor, while the ALTER re-derived the
 * type from a call that dropped `options` and `validation` on the way. A number switched to a
 * fractional format was therefore correctly detected and then rewritten as a whole-number column.
 *
 * The statement's SHAPE is dialect-specific too. `ALTER COLUMN … TYPE` is PostgreSQL; MySQL spells it
 * `MODIFY COLUMN` and restates the whole definition, so a column's NOT NULL has to travel with the
 * type or the change quietly makes it nullable.
 */
describe("changing a number's storage on an existing table", () => {
  const alter = (
    dialect: Dialect,
    before: FieldDefinition,
    after: FieldDefinition
  ): string =>
    new DynamicCollectionSchemaService(
      undefined,
      dialect
    ).generateAlterTableMigration(TABLE, [before], [after], {
      tableHasRows: false,
    });

  const whole = (name: string): FieldDefinition =>
    ({ name, type: "number" }) as unknown as FieldDefinition;

  const float = (name: string): FieldDefinition =>
    ({
      name,
      type: "number",
      options: { format: "float" },
    }) as unknown as FieldDefinition;

  it("renders the fractional type it detected, not a whole-number one — postgresql", () => {
    const sql = alter("postgresql", whole("amount"), float("amount"));

    // The defect was silent: the ALTER ran, reported success, and left an integer column while the
    // field metadata said float. Naming the wrong type keeps the failure legible.
    expect(sql).not.toMatch(/TYPE\s+integer/i);
    // `float8`, which is the DESCRIPTOR's answer for a fractional number on PostgreSQL. The old
    // generator spelled it `decimal(10,2)`; taking the descriptor's is the point, because it is the
    // column the runtime table and the diff both read through.
    expect(sql).toMatch(/ALTER COLUMN "amount" TYPE float8/i);
    // PostgreSQL refuses most cross-family changes without it, so its absence turned a migration
    // that generated cleanly into one that failed at apply time.
    expect(sql).toMatch(/USING "amount"::float8/i);
  });

  it("uses MODIFY COLUMN and keeps the column's nullability — mysql", () => {
    const before = { ...whole("amount"), required: true } as FieldDefinition;
    const after = { ...float("amount"), required: true } as FieldDefinition;
    const sql = alter("mysql", before, after);

    // PostgreSQL's spelling is a syntax error on MySQL, so the update failed before the type was
    // ever applied.
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).toMatch(/MODIFY COLUMN `amount`/i);
    // MySQL's MODIFY replaces the definition. Without this the column silently becomes nullable.
    expect(sql).toMatch(/MODIFY COLUMN `amount`[^;]*NOT NULL/i);
  });

  it("carries exact decimals through the change too — mysql", () => {
    const sql = alter("mysql", whole("price"), money("price"));

    // The dimensions `money` declares — 12 and 4 — not a fixed pair, so a change to the shared
    // fixture cannot leave this asserting something the fixture no longer produces.
    expect(sql).toMatch(/MODIFY COLUMN `price` decimal\(12,\s*4\)/i);
  });

  it("emits nothing when the storage did not change", () => {
    // The positive control. A rule that emitted an ALTER for every field would satisfy all three
    // cases above while rewriting every column on every save.
    expect(alter("postgresql", whole("amount"), whole("amount"))).not.toMatch(
      /ALTER COLUMN "amount" TYPE/i
    );
  });
});

/**
 * What an ALTER must NOT do.
 *
 * `isFieldModified` answers true for an index or a unique constraint as well as for a change of
 * storage, and those are not the same question. Rewriting the column type for an index toggle is not
 * a harmless no-op, because the type written is the DESCRIPTOR's and the descriptor does not yet
 * agree with the generator that created the column: a Builder `select` is created as unbounded
 * `text`, so re-rendering it as `varchar(255)` truncates every stored value past 255 characters —
 * for an edit that never touched its storage.
 *
 * MySQL adds a second way to lose data silently: `MODIFY COLUMN` restates the WHOLE definition, so
 * anything omitted is dropped. Nullability and the default both have to travel with the type.
 */
describe("an ALTER changes only what actually changed", () => {
  const alter = (
    dialect: Dialect,
    before: FieldDefinition,
    after: FieldDefinition
  ): string =>
    new DynamicCollectionSchemaService(
      undefined,
      dialect
    ).generateAlterTableMigration(TABLE, [before], [after], {
      tableHasRows: false,
    });

  const select = (extra: Record<string, unknown> = {}): FieldDefinition =>
    ({
      name: "category",
      type: "select",
      options: { options: [{ label: "One", value: "one" }] },
      ...extra,
    }) as unknown as FieldDefinition;

  it.each<[Dialect, RegExp]>([
    ["mysql", /MODIFY COLUMN/i],
    ["postgresql", /ALTER COLUMN "category" TYPE/i],
  ])(
    "does not rewrite a column's type when only its index changed — %s",
    (dialect, rewrite) => {
      const sql = alter(dialect, select(), select({ index: true }));

      // The index itself still gets created; it is the TYPE rewrite that must not happen.
      expect(sql).toMatch(/CREATE INDEX/i);
      expect(sql).not.toMatch(rewrite);
    }
  );

  it("keeps a default when modifying a column — mysql", () => {
    const before = {
      name: "amount",
      type: "number",
      default: 0,
    } as unknown as FieldDefinition;
    const after = {
      name: "amount",
      type: "number",
      dbType: "decimal",
      precision: 12,
      scale: 4,
      default: 0,
    } as unknown as FieldDefinition;

    const sql = alter("mysql", before, after);

    expect(sql).toMatch(/MODIFY COLUMN `amount`/i);
    // Omitted, MySQL drops the default the create path emitted, and later inserts that leave the
    // field out write NULL or fail outright on a required column.
    expect(sql).toMatch(/MODIFY COLUMN `amount`[^;]*DEFAULT 0/i);
  });

  it("ignores decimal properties on a field that is not the built-in number", () => {
    // A plugin type persists as the `number` storage primitive, but `dbType`/`precision`/`scale` are
    // the built-in number field's vocabulary. Honouring them here would give the plugin a decimal
    // column while the descriptor still describes an integer, and would route around the dimension
    // validation, which only inspects fields whose declared type IS `number`.
    //
    // 🔴 The type is REGISTERED, and that is the whole precondition. An unregistered type resolves
    // to nothing, falls through to `text`, and satisfies both assertions below without the guard
    // ever running — a test that passes for a reason unrelated to what it claims to prove.
    registerFieldType({
      type: "star-rating",
      storage: "number",
      component: "@acme/ratings/admin#StarRating",
      surfaces: ["entries"],
    });

    const plugin = {
      name: "rating",
      type: "star-rating",
      dbType: "decimal",
      precision: 12,
      scale: 4,
    } as unknown as FieldDefinition;

    const sql = new DynamicCollectionSchemaService(
      undefined,
      "postgresql"
    ).generateMigrationSQL(TABLE, [plugin], {});

    // Reaching the number branch at all is the precondition: an unresolved type would be `text`.
    expect(sql.toLowerCase()).toContain("integer");
    expect(sql.toLowerCase()).not.toContain("numeric(12, 4)");
  });

  it("still honours decimal properties on the built-in number", () => {
    // The positive control for the guard above. Without it, dropping decimal support entirely would
    // satisfy that case while breaking every real money field.
    const sql = new DynamicCollectionSchemaService(
      undefined,
      "postgresql"
    ).generateMigrationSQL(TABLE, [money("price")], {});

    expect(sql.toLowerCase()).toContain("numeric(12, 4)");
  });
});
