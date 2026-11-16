/**
 * `db:sync` and the development push class a type change they offer by the repair command's rule,
 * and describe it in the repair report's words.
 *
 * One judgement, made by `judgeColumn` over one column's values, is handed to the push's classifier
 * and to the repair's report. The class the push acts on is that judgement's class, and the text
 * each prints for it holds the same class, reason and rows. A safe conversion asks nothing; a
 * blocked one is refused before anything runs, naming its rows and what the owner can change, with
 * the push's own next step; a pair the rule has no conversion for is asked about as before, with
 * how many rows hold a value. Without the rule (a Schema Builder save), the offer is as before.
 */
import { describe, expect, it } from "vitest";

import { NO_RUN_FACTS } from "../../../repair-columns/outcome";
import { formatRecord, repairRecord } from "../../../repair-columns/report";
import type { DiffersFinding } from "../../../repair-columns/types";
import { judgeColumn } from "../../../value-conversion/judge-column";
import type {
  ColumnConversion,
  ConversionJudgement,
  StoredValue,
} from "../../../value-conversion/types";
import type { ChangeColumnTypeOp } from "../../diff/types";
import type { TypeChangeEvent } from "../../resolution/types";
import { RealClassifier } from "../classifier";
import type { JudgedTypeChange } from "../judge-type-change";

const TABLE = "dc_posts";

const textToJsonb: ColumnConversion = {
  dialect: "postgresql",
  from: { type: "text", nullable: true },
  to: { type: "jsonb", nullable: true },
  compareAs: "json",
};

const textToVarchar: ColumnConversion = {
  dialect: "postgresql",
  from: { type: "text", nullable: true },
  to: { type: "varchar", nullable: true, typeModifier: "5" },
  compareAs: "exact",
};

const value = (id: string, text: string | null): StoredValue => ({
  key: { id },
  text,
});

const op = (
  column: string,
  fromType: string,
  toType: string
): ChangeColumnTypeOp => ({
  type: "change_column_type",
  tableName: TABLE,
  columnName: column,
  fromType,
  toType,
});

/** The push's classifier over `ops`, each judged as `judged` says (absent: no rule given). */
function classify(
  ops: ChangeColumnTypeOp[],
  judged?: (op: ChangeColumnTypeOp) => JudgedTypeChange | null,
  dialect: "postgresql" | "mysql" | "sqlite" = "postgresql"
) {
  return new RealClassifier().classify({
    operations: ops,
    countNulls: () => Promise.resolve(1),
    countRows: () => Promise.resolve(3),
    dialect,
    ...(judged
      ? {
          judgeConversion: (o: ChangeColumnTypeOp) =>
            Promise.resolve(judged(o)),
          nextStep: "run db:sync again",
        }
      : {}),
  });
}

/** The repair report's line for the same column under the same judgement. */
function repairLine(
  judgement: ConversionJudgement,
  live: string,
  expected: string
): string {
  const finding: DiffersFinding = {
    kind: "differs",
    location: {
      kind: "collection",
      slug: "posts",
      field: "links",
      table: TABLE,
      column: "links",
      translation: false,
    },
    expected: { type: expected, nullable: true },
    live: { type: live, nullable: true },
    aspects: { type: true, nullability: false },
    cause: null,
    judgement,
    conversion: null,
    rowsRewritten: null,
  };
  return formatRecord(repairRecord(finding, NO_RUN_FACTS, "dry-run"));
}

describe("the push's type-change offer and the repair's rule", () => {
  it("db:sync, the development push and the repair report take class and wording from one rule", async () => {
    const judgement = await judgeColumn(textToJsonb, [
      value("p0", '{"a":1}'),
      value("p1", ""),
      value("p2", null),
    ]);
    expect(judgement.class).toBe("lossy");

    const result = await classify([op("links", "text", "jsonb")], () => ({
      judgement,
      keyedBy: "id",
      cleared: [{ id: "p1" }],
    }));

    const [event] = result.events as TypeChangeEvent[];
    expect(event.kind).toBe("type_change");
    // The class the push acts on is the rule's own judgement, not one of its own.
    expect(event.lossy?.judgement).toBe(judgement);
    expect(event.lossy?.cleared).toEqual([{ id: "p1" }]);
    expect(event.dialect).toBe("postgresql");

    const words =
      "lossy: values that do not parse as JSON would be cleared (1 row: id p1)";
    expect(repairLine(judgement, "text", "jsonb")).toContain(words);
  });

  it("refuses a blocked conversion before anything runs, in the repair's words, with the push's next step", async () => {
    const judgement = await judgeColumn(textToVarchar, [
      value("p0", "short"),
      value("p2", "far too long"),
    ]);
    expect(judgement.class).toBe("blocked");

    await expect(
      classify([op("slug", "text", "varchar(5)")], () => ({
        judgement,
        keyedBy: "id",
        cleared: [],
      }))
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: `schema.${TABLE}.slug`,
            code: "CONVERSION_BLOCKED",
            message:
              `${TABLE}.slug: text -> varchar(5) is blocked: values longer than the new type holds would be cut (1 row: id p2). ` +
              "The owner can: shorten the named values so each fits the new type, then run db:sync again.",
          },
        ],
      },
    });

    const repair = repairLine(judgement, "text", "varchar(5)");
    expect(repair).toContain(
      "blocked: values longer than the new type holds would be cut (1 row: id p2)"
    );
    expect(repair).toContain(
      "shorten the named values so each fits the new type, then run the repair again"
    );
  });

  it("goes ahead with a safe conversion without asking, counting the rows it checked", async () => {
    const judgement = await judgeColumn(textToJsonb, [
      value("p0", '{"a":1}'),
      value("p1", "[]"),
    ]);
    const result = await classify([op("links", "text", "jsonb")], () => ({
      judgement,
      keyedBy: "id",
      cleared: [],
    }));
    expect(result.events).toEqual([]);
    expect(result.level).toBe("safe");
    expect(result.safeConversions).toEqual([
      {
        tableName: TABLE,
        columnName: "links",
        fromType: "text",
        toType: "jsonb",
        rowsChecked: 3,
      },
    ]);
  });

  it("asks about a pair the rule has no conversion for as before, saying how many rows hold a value", async () => {
    const judgement = await judgeColumn(
      {
        ...textToJsonb,
        from: { type: "timestamp", nullable: true },
        to: { type: "text", nullable: true },
      },
      []
    );
    expect(judgement.reasons.map(r => r.kind)).toEqual(["no-conversion"]);

    const result = await classify([op("seen", "timestamp", "text")], () => ({
      judgement,
      keyedBy: "id",
      cleared: [],
    }));
    const [event] = result.events as TypeChangeEvent[];
    expect(event.kind).toBe("type_change");
    expect(event.lossy).toBeUndefined();
    // countRows 3, countNulls 1: two rows hold a value.
    expect(event.rowsHoldingValue).toBe(2);
    expect(result.level).toBe("destructive");
  });

  it("judges a widening too: a SQLite integer becoming a real is lossy where a row holds a word", async () => {
    const judgement = await judgeColumn(
      {
        dialect: "sqlite",
        from: { type: "integer", nullable: true },
        to: { type: "real", nullable: true },
        compareAs: "number",
      },
      [
        { key: { id: "p0" }, text: "3", storage: "integer" },
        { key: { id: "p1" }, text: "word", storage: "text" },
      ]
    );
    expect(judgement.class).toBe("lossy");

    const result = await classify(
      [op("price", "integer", "real")],
      () => ({ judgement, keyedBy: "id", cleared: [{ id: "p1" }] }),
      "sqlite"
    );
    const [event] = result.events as TypeChangeEvent[];
    expect(event.lossy?.judgement).toBe(judgement);
  });

  it("makes a widening the rule has no conversion for without a word, as before", async () => {
    const judgement = await judgeColumn(
      {
        dialect: "mysql",
        from: { type: "tinyint", nullable: true },
        to: { type: "int", nullable: true },
        compareAs: "number",
      },
      []
    );
    expect(judgement.reasons.map(r => r.kind)).toEqual(["no-conversion"]);

    const result = await classify(
      [op("rank", "tinyint", "int")],
      () => ({ judgement, keyedBy: "id", cleared: [] }),
      "mysql"
    );
    expect(result.events).toEqual([]);
    expect(result.safeConversions).toEqual([]);
  });

  it("offers a type change as before where no rule is given (a Schema Builder save)", async () => {
    const result = await classify([op("links", "text", "jsonb")]);
    const [event] = result.events as TypeChangeEvent[];
    expect(event.kind).toBe("type_change");
    expect(event.lossy).toBeUndefined();
    expect(event.rowsHoldingValue).toBeUndefined();
    expect(result.safeConversions).toBeUndefined();
  });
});
