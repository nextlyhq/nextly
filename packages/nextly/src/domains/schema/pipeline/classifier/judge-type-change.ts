// Judging a type change the push offers by the repair command's rule.
//
// `db:sync` and the development push offer to convert a column whenever its configured type
// differs from the live one. Whether that conversion keeps, clears or would cut the stored values
// is the question `value-conversion/judge-column` answers for a repair, so it is asked here in the
// same terms: the column as the database has it, the column the configuration expects, how the
// field reads its values, and the rows keyed as the live table keys them. Never a second rule:
// a repair and a push name the same class, reason and rows for one column.
//
// The Schema Builder's type change on a saved field judges the same way through this one entry.
//
// @module domains/schema/pipeline/classifier/judge-type-change

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { fieldsByColumnOf } from "../../required-column-registries";
import { compareAsFor } from "../../value-conversion/compare-as";
import { reasonClass } from "../../value-conversion/judge-column";
import {
  judgeStoredColumn,
  keyedByOf,
  type KeyedBy,
} from "../../value-conversion/read-values";
import type {
  ColumnConversion,
  ColumnType,
  ConversionJudgement,
  RowKey,
} from "../../value-conversion/types";
import type {
  ChangeColumnTypeOp,
  ColumnSpec,
  NextlySchemaSnapshot,
  TableSpec,
} from "../diff/types";
import type { DesiredSchema } from "../types";

/** One offered type change, judged from the rows its column holds. */
export interface JudgedTypeChange {
  judgement: ConversionJudgement;
  /** How the live table keys its rows, which is how a clearing names them. */
  keyedBy: KeyedBy;
  /**
   * Every row whose value the conversion would clear, past the bound the judgement names: the rows
   * a consented conversion clears, read from the same pass that classed it.
   */
  cleared: RowKey[];
}

/** Judges one offered type change; null where the live or expected column cannot be found. */
export type TypeChangeJudge = (
  op: ChangeColumnTypeOp
) => Promise<JudgedTypeChange | null>;

const byName = <T extends { name: string }>(
  items: readonly T[],
  name: string
): T | undefined =>
  items.find(item => item.name.toLowerCase() === name.toLowerCase());

/** The field whose column `column` of `table` is, from the entity that declares the table. */
function fieldOf(
  schema: DesiredSchema,
  table: string,
  column: string,
  dialect: SupportedDialect
): FieldDefinition | undefined {
  const entities = [
    ...Object.values(schema.collections).map(e => ({ e, group: false })),
    ...Object.values(schema.singles).map(e => ({ e, group: false })),
    ...Object.values(schema.components).map(e => ({ e, group: true })),
  ];
  const owner = entities.find(
    ({ e }) => e.tableName.toLowerCase() === table.toLowerCase()
  );
  if (owner === undefined) return undefined;
  const fields = owner.e.fields as readonly FieldDefinition[];
  const name = fieldsByColumnOf(fields, dialect, owner.group).get(
    column.toLowerCase()
  );
  return fields.find(field => field.name === name);
}

const stateOf = (
  column: ColumnSpec,
  nullable: boolean = column.nullable
): ColumnType => ({
  type: column.type,
  nullable,
  ...(column.typeModifier !== undefined
    ? { typeModifier: column.typeModifier }
    : {}),
});

/**
 * The conversion an offered type change asks for. The new column keeps the live nullability: a
 * consented clearing runs before the type change and before any change to the column's NOT NULL,
 * so a value it clears must be one the column as it stands can hold as a null. A change to the
 * nullability is judged on its own (`add_not_null_with_nulls`).
 */
function conversionOf(
  op: ChangeColumnTypeOp,
  live: ColumnSpec,
  expected: ColumnSpec,
  field: FieldDefinition | undefined,
  dialect: SupportedDialect
): ColumnConversion {
  const to = stateOf(expected, live.nullable);
  return {
    dialect,
    from: stateOf(live),
    to,
    compareAs: compareAsFor(field, to),
    ...(op.conversion === "referenceList" ? { referenceList: true } : {}),
  };
}

/**
 * The judge `db:sync` and the development push class their type changes with, bound to the
 * database and to the live and expected schemas this apply compares.
 */
export function typeChangeJudge(args: {
  db: unknown;
  dialect: SupportedDialect;
  live: NextlySchemaSnapshot;
  expected: NextlySchemaSnapshot;
  schema: DesiredSchema;
}): TypeChangeJudge {
  return async op => {
    const liveTable: TableSpec | undefined = byName(
      args.live.tables,
      op.tableName
    );
    const expectedTable = byName(args.expected.tables, op.tableName);
    const live = liveTable && byName(liveTable.columns, op.columnName);
    const expected =
      expectedTable && byName(expectedTable.columns, op.columnName);
    if (!liveTable || !live || !expected) return null;

    const keyedBy = keyedByOf(liveTable.columns);
    const cleared: RowKey[] = [];
    const judgement = await judgeStoredColumn(
      args.db,
      conversionOf(
        op,
        live,
        expected,
        fieldOf(args.schema, op.tableName, op.columnName, args.dialect),
        args.dialect
      ),
      { table: liveTable.name, column: live.name, keyedBy },
      {
        noteRow: (kind, key) => {
          if (reasonClass(kind) === "lossy") cleared.push(key);
        },
      }
    );
    return { judgement, keyedBy, cleared };
  };
}
