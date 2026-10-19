/**
 * Converting a column of stored references into the JSON list column.
 *
 * A component's many-to-many was created as a scalar column before it held a list: `uuid` or `text`
 * on PostgreSQL, `varchar(36)` on MySQL. Those rows hold a bare id, a PostgreSQL array literal
 * (`{"a","b"}`), or a JSON list, none of which a plain cast turns into a list: PostgreSQL has no cast
 * from `uuid` to `jsonb` and refuses a bare id or an array literal as JSON text, and MySQL refuses a
 * bare id as a JSON document. So the diff marks the change as a reference-list conversion, and each
 * consumer renders the statements that read every stored shape as a list.
 */
import { describe, expect, it } from "vitest";

import { buildInverseOperations } from "../../migrate-create/down-generator";
import { diffSnapshots } from "../diff/diff";
import type {
  ChangeColumnTypeOp,
  ColumnSpec,
  NextlySchemaSnapshot,
} from "../diff/types";
import { isPreResolutionOp } from "../diff/types";
import { emitDdl } from "../ddl-emitter";
import {
  isReferenceListConversion,
  referenceListConversionStatements,
} from "../reference-list-conversion";
import { generateSQL } from "../sql-templates";

const BASE: ColumnSpec[] = [{ name: "id", type: "text", nullable: false }];

function snapshot(column: ColumnSpec): NextlySchemaSnapshot {
  return { tables: [{ name: "comp_hero", columns: [...BASE, column] }] };
}

function typeChange(
  live: ColumnSpec,
  desired: ColumnSpec
): ChangeColumnTypeOp | undefined {
  return diffSnapshots(snapshot(live), snapshot(desired)).find(
    (op): op is ChangeColumnTypeOp => op.type === "change_column_type"
  );
}

const desiredList: ColumnSpec = {
  name: "tags",
  type: "jsonb",
  nullable: true,
  holdsReferenceList: true,
};

describe("the diff marks a reference-list conversion", () => {
  it.each(["uuid", "text"])(
    "for a PostgreSQL %s column becoming the list column",
    liveType => {
      const op = typeChange(
        { name: "tags", type: liveType, nullable: true },
        desiredList
      );
      expect(op).toMatchObject({
        toType: "jsonb",
        conversion: "referenceList",
      });
    }
  );

  it("for a MySQL varchar(36) column becoming the list column", () => {
    const op = typeChange(
      { name: "tags", type: "varchar(36)", nullable: true },
      { ...desiredList, type: "json" }
    );
    expect(op).toMatchObject({ toType: "json", conversion: "referenceList" });
  });

  it("not for a JSON column that holds no references", () => {
    const op = typeChange(
      { name: "meta", type: "text", nullable: true },
      { name: "meta", type: "jsonb", nullable: true }
    );
    expect(op).toBeDefined();
    expect(op?.conversion).toBeUndefined();
  });
});

const pgOp: ChangeColumnTypeOp = {
  type: "change_column_type",
  tableName: "comp_hero",
  columnName: "tags",
  fromType: "uuid",
  toType: "jsonb",
  nullable: true,
  fromNullable: true,
  conversion: "referenceList",
};
const mysqlOp: ChangeColumnTypeOp = {
  ...pgOp,
  fromType: "varchar(36)",
  toType: "json",
};

describe("the statements a reference-list conversion runs", () => {
  it("is one statement on PostgreSQL, reading each stored shape as a list", () => {
    const statements = referenceListConversionStatements(pgOp, "postgresql");
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement).toMatch(
      /^ALTER TABLE "comp_hero" ALTER COLUMN "tags" SET DATA TYPE jsonb USING CASE/
    );
    // An array literal, a JSON list and a bare id each have their own reading.
    expect(statement).toContain(`to_jsonb("tags"::text::text[])`);
    expect(statement).toContain(`"tags"::text::jsonb`);
    expect(statement).toContain(`jsonb_build_array("tags"::text)`);
  });

  it("widens, wraps each bare value in a list, then retypes on MySQL", () => {
    const statements = referenceListConversionStatements(mysqlOp, "mysql");
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe(
      "ALTER TABLE `comp_hero` MODIFY COLUMN `tags` text NULL"
    );
    expect(statements[1]).toMatch(/^UPDATE `comp_hero` SET `tags` = CASE/);
    expect(statements[1]).toContain("JSON_ARRAY(`tags`)");
    expect(statements[2]).toBe(
      "ALTER TABLE `comp_hero` MODIFY COLUMN `tags` json NULL"
    );
  });

  it("restates NOT NULL on MySQL when the column keeps it", () => {
    const statements = referenceListConversionStatements(
      { ...mysqlOp, nullable: false },
      "mysql"
    );
    expect(statements[0]).toMatch(/text NOT NULL$/);
    expect(statements[2]).toMatch(/json NOT NULL$/);
  });

  it("is what a migration file gets, so a file and a live apply agree", () => {
    expect(generateSQL(pgOp, "postgresql")).toBe(
      referenceListConversionStatements(pgOp, "postgresql").join("; ")
    );
    expect(generateSQL(mysqlOp, "mysql")).toBe(
      referenceListConversionStatements(mysqlOp, "mysql").join("; ")
    );
  });
});

describe("where a reference-list conversion runs in an apply", () => {
  it("runs before the route's DDL, so neither the emitter nor drizzle-kit casts it", () => {
    expect(isReferenceListConversion(pgOp)).toBe(true);
    expect(isPreResolutionOp(pgOp)).toBe(true);
    expect(emitDdl([pgOp], "postgresql")).toEqual([]);
  });

  it("leaves an ordinary type change to the route", () => {
    const plain: ChangeColumnTypeOp = { ...pgOp, conversion: undefined };
    expect(isReferenceListConversion(plain)).toBe(false);
    expect(isPreResolutionOp(plain)).toBe(false);
  });
});

describe("the generated DOWN of a reference-list conversion", () => {
  it("is a plain type change back, not a second conversion", () => {
    const [inverse] = buildInverseOperations([pgOp], { tables: [] });
    expect(inverse).toMatchObject({
      type: "change_column_type",
      fromType: "jsonb",
      toType: "uuid",
    });
    expect((inverse as ChangeColumnTypeOp).conversion).toBeUndefined();
  });
});
