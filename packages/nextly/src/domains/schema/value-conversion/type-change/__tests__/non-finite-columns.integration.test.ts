/**
 * Which number columns hold `NaN`, `Infinity` and `-Infinity`, measured on each database. The
 * manuals leave several of these open (SQLite's real, MySQL's float and double, PostgreSQL's
 * constrained numeric and `NaN`), and the type-change judgement decides whether such a value is
 * kept or lost by `holdsNonFinite`, so each cell it answers is measured here against the column a
 * number field's creator makes, written as Nextly writes a value: as a bound parameter.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../../dynamic-collections/services/dynamic-collection-schema-service";
import {
  LOCK_DIALECTS,
  lockWorld,
} from "../../../pipeline/__tests__/helpers/schema-lock-world";
import { splitStatements } from "../../../pipeline/sql-statement-utils";
import { fieldTypeOnDialect } from "../field-type";
import { holdsNonFinite } from "../judge";
import { readNumber } from "../numbers";

const TABLE = "dc_tc_non_finite";

/** A whole-number field, a float field and a decimal field, as the Builder stores them. */
const FIELDS = [
  { name: "i", type: "number" },
  { name: "f", type: "number", options: { format: "float" } },
  { name: "d", type: "number", dbType: "decimal" },
] as unknown as FieldDefinition[];

const NON_FINITE = ["NaN", "Infinity", "-Infinity"] as const;

describe.each(LOCK_DIALECTS)("non-finite numbers in number columns on %s", dialect => {
  let adapter: DrizzleAdapter;
  const q = (name: string) => (dialect === "mysql" ? `\`${name}\`` : `"${name}"`);
  const p = (n: number) => (dialect === "postgresql" ? `$${n}` : "?");

  beforeEach(async () => {
    const world = await lockWorld(dialect, { fresh: true });
    adapter = await world.connect();
    const sql = new DynamicCollectionSchemaService(undefined, dialect).generateMigrationSQL(
      TABLE,
      FIELDS
    );
    for (const statement of splitStatements([sql])) {
      await adapter.executeQuery(statement);
    }
  }, 120_000);

  afterEach(async () => {
    await adapter.disconnect();
  });

  /**
   * Whether the column holds `value`: it is written as a bound parameter and reads back as the same
   * non-finite number. A refused write, or one that reads back as anything else (no value, a
   * finite number), does not hold it.
   */
  async function holds(column: "i" | "f" | "d", value: (typeof NON_FINITE)[number]): Promise<boolean> {
    const id = `${column}-${value}`;
    try {
      await adapter.executeQuery(
        `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q(column)}) VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)})`,
        [id, id, id, Number(value)]
      );
    } catch {
      return false;
    }
    const [row] = await adapter.executeQuery<{ v: unknown }>(
      `SELECT ${q(column)} AS v FROM ${q(TABLE)} WHERE ${q("id")} = ${p(1)}`,
      [id]
    );
    if (row?.v === null || row?.v === undefined) return false;
    const back = readNumber(String(row.v));
    return back !== null && !back.finite && back.value === value;
  }

  // The measurement's positive control: a finite number written the same way reads back, so a
  // non-finite one that does not is refused by the column, not by the write itself.
  it("writes a finite number to both columns and reads it back", async () => {
    for (const column of ["f", "d"] as const) {
      const id = `${column}-finite`;
      await adapter.executeQuery(
        `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q(column)}) VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)})`,
        [id, id, id, 1.5]
      );
      const [row] = await adapter.executeQuery<{ v: unknown }>(
        `SELECT ${q(column)} AS v FROM ${q(TABLE)} WHERE ${q("id")} = ${p(1)}`,
        [id]
      );
      expect(Number(row?.v)).toBe(1.5);
    }
  }, 60_000);

  for (const [column, label] of [
    ["i", "a whole-number"],
    ["f", "a float"],
    ["d", "a decimal"],
  ] as const) {
    for (const value of NON_FINITE) {
      it(`judges ${value} in ${label} column as the database holds it`, async () => {
        const field = FIELDS.find(f => f.name === column);
        if (!field) throw new Error(`no field ${column}`);
        const format = fieldTypeOnDialect(field, dialect, "collection").number;
        if (!format) throw new Error(`no number format for ${column}`);
        expect(holdsNonFinite(format, dialect, value)).toBe(await holds(column, value));
      }, 60_000);
    }
  }
});
