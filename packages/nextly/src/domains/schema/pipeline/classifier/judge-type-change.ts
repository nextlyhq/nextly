// Judging a type change the push offers by the repair command's rule.
//
// `db:sync` and the development push offer to convert a column whenever its configured type
// differs from the live one. Whether that conversion keeps, clears or would cut the stored values
// is the question `value-conversion/judge-column` answers for a repair, so it is asked here in the
// same terms: the column as the database has it, the column the configuration expects, how the
// field reads its values, and the rows keyed as the live table keys them. Never a second rule:
// a repair and a push name the same class, reason and rows for one column.
//
// That rule judges the column, not the field: on SQLite no conversion runs and a column keeps any
// value, so it finds a "maybe" kept in a checkbox's column and 1.5 in a whole number's, and on
// MySQL it keeps two texts a unique column's collation holds as one. So on every database the push
// also asks what the new field reads from each value, by the judge a Schema Builder save asks
// (`value-conversion/type-change`), with the field the registry recorded before the apply and the
// field the configuration declares now, and takes the worse of the two. Never a rule of its own,
// with one difference a push alone has: a code-first field's own `validate` function is not asked
// of stored values (`withoutOwnValidate`), since it is written for a whole entry and its request.
//
// @module domains/schema/pipeline/classifier/judge-type-change

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { ValidatableField } from "../../../../shared/lib/entry-validation";
import { rowKeyText } from "../../repair-columns/clearing";
import { fieldsByColumnOf } from "../../required-column-registries";
import {
  fieldsStoredOnRow,
  type ColumnOrigin,
} from "../../services/field-column-descriptor";
import { compareAsFor } from "../../value-conversion/compare-as";
import {
  AFFECTED_ROWS_BOUND,
  reasonClass,
} from "../../value-conversion/judge-column";
import {
  judgeStoredColumn,
  keyedByOf,
  readStoredValues,
  type KeyedBy,
} from "../../value-conversion/read-values";
import {
  fieldTypeChangesOf,
  judgeFieldTypeChanges,
} from "../../value-conversion/type-change/field-type-changes";
import type {
  ColumnConversion,
  ColumnType,
  ConversionClass,
  ConversionJudgement,
  RowKey,
} from "../../value-conversion/types";
import type {
  ChangeColumnTypeOp,
  ColumnSpec,
  NextlySchemaSnapshot,
  TableSpec,
} from "../diff/types";
import { builtByFor } from "../registered-collections";
import type { DesiredSchema } from "../types";
import { uniqueColumnLookup } from "../unique-columns";

import {
  rebuiltIndexRepeats,
  type IndexedColumn,
} from "./rebuilt-index-repeats";

/**
 * An entity's fields before and after the apply, and how its table is made: what the per-value
 * judge reads a column's type change from. Plain data, so a type change carries it to the apply,
 * which judges the column again before it clears anything.
 */
export interface FieldReadings {
  /** The entity's fields as the registry recorded them before the apply. */
  previous: readonly FieldDefinition[];
  /** Its fields as the configuration declares them now. */
  next: readonly FieldDefinition[];
  /** The one of `next` whose column is judged. */
  field: string;
  builtBy: ColumnOrigin;
  /** Whether the fields are kept on a field group's row. */
  componentRow?: true;
  /**
   * Whether the schema being applied makes the column unique (`uniqueColumnLookup`): by its field,
   * or by a single-column unique index its entity declares.
   */
  unique?: true;
  /**
   * On SQLite, for each unique index of several columns the column is one of, the index's other
   * columns as the live table names them, each with its type once the table is rebuilt: the
   * values that, beside this column's, the index holds once.
   */
  uniqueWith?: readonly (readonly IndexedColumn[])[];
}

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
  /** The conversion judged: the apply judges it again, on the rows as they are, before clearing. */
  conversion: ColumnConversion;
  /**
   * The fields the per-value judge was also asked with, where it was: on SQLite, for a column
   * whose field before the apply is known. The apply's second judgement asks it the same.
   */
  fieldReadings?: FieldReadings;
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

/** The entity that declares `table`, with its kind. */
function ownerOf(schema: DesiredSchema, table: string) {
  const entities = [
    ...Object.values(schema.collections).map(e => ({
      e,
      kind: "collection" as const,
    })),
    ...Object.values(schema.singles).map(e => ({ e, kind: "single" as const })),
    ...Object.values(schema.components).map(e => ({
      e,
      kind: "fieldGroup" as const,
    })),
  ];
  return entities.find(
    ({ e }) => e.tableName.toLowerCase() === table.toLowerCase()
  );
}

/** The field whose column `column` of `table` is, from the entity that declares the table. */
function fieldOf(
  schema: DesiredSchema,
  table: string,
  column: string,
  dialect: SupportedDialect
): FieldDefinition | undefined {
  const owner = ownerOf(schema, table);
  if (owner === undefined) return undefined;
  // Every field whose column is on the row: a group with no name only lays its fields out, so
  // the fields inside it are found as the ones beside it are (`fieldsStoredOnRow`).
  const fields = fieldsStoredOnRow(
    owner.e.fields as readonly FieldDefinition[]
  );
  const name = fieldsByColumnOf(
    fields,
    dialect,
    owner.kind === "fieldGroup"
  ).get(column.toLowerCase());
  return fields.find(field => field.name === name);
}

/**
 * What the per-value judge is asked with for `field`'s column, on every database: only where the
 * registry recorded the entity's fields before the apply. Without that record nothing says what
 * the column's values were written as, so the column rule judges alone.
 */
function fieldReadingsOf(
  schema: DesiredSchema,
  table: string,
  field: FieldDefinition | undefined,
  unique: boolean,
  uniqueWith: readonly (readonly IndexedColumn[])[]
): FieldReadings | undefined {
  if (field === undefined) return undefined;
  const owner = ownerOf(schema, table);
  const previous = owner?.e.recordedFields;
  if (owner === undefined || previous === undefined) return undefined;
  return {
    previous: previous as readonly FieldDefinition[],
    next: owner.e.fields as readonly FieldDefinition[],
    field: field.name,
    builtBy: builtByFor(owner.kind, owner.e.builderOwned),
    ...(owner.kind === "fieldGroup" ? { componentRow: true as const } : {}),
    ...(unique ? { unique: true as const } : {}),
    ...(uniqueWith.length > 0 ? { uniqueWith } : {}),
  };
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
 * The conversion an offered type change asks for. The new column allows a null only where it does
 * both now and once the apply is done: a value cleared must be one the column holds as a null
 * before the type change (the clearing runs first) and after it. A column the apply also makes
 * NOT NULL therefore judges a value it would clear as one a value would have to be invented for
 * (`cleared-under-not-null`), and a null it already holds the same way, as the repair rule does.
 */
function conversionOf(
  op: ChangeColumnTypeOp,
  live: ColumnSpec,
  expected: ColumnSpec,
  field: FieldDefinition | undefined,
  dialect: SupportedDialect
): ColumnConversion {
  const to = stateOf(expected, live.nullable && expected.nullable);
  return {
    dialect,
    from: stateOf(live),
    to,
    compareAs: compareAsFor(field, to),
    ...(op.conversion === "referenceList" ? { referenceList: true } : {}),
  };
}

const RANK: Record<ConversionClass, number> = { safe: 0, lossy: 1, blocked: 2 };

/** A column's judgement, and every row whose value it would clear. */
interface ColumnVerdict {
  judgement: ConversionJudgement;
  cleared: RowKey[];
}

/**
 * The per-value judge's verdict on the column of `readings.field`, or null where it finds no type
 * change of that field to judge (the field is new, or its type reads the same before and after).
 */
async function fieldVerdict(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  readings: FieldReadings
): Promise<ColumnVerdict | null> {
  const at = {
    builtBy: readings.builtBy,
    ...(readings.componentRow === true ? { componentRow: true } : {}),
  };
  const changes = fieldTypeChangesOf({
    previous: readings.previous,
    next: readings.next,
    dialect,
    ...at,
  })
    .filter(change => change.to.name === readings.field)
    // A column the schema makes unique by a declared index is unique to the judge as one made so
    // by its field: it then counts two values the new type reads as one, which block the change.
    .map(change =>
      readings.unique === true
        ? { ...change, to: { ...change.to, unique: true } }
        : change
    )
    .map(withoutOwnValidate);
  const [judged] = await judgeFieldTypeChanges({
    db,
    dialect,
    table,
    changes,
    ...at,
  });
  return judged === undefined
    ? null
    : { judgement: judged.result.judgement, cleared: judged.result.cleared };
}

/**
 * `change` with the new field's own `validate` function left out, so the judge asks only the
 * field's built-in rules of each stored value.
 *
 * That function is written for a whole entry and its request: it may read the entry's other
 * fields, or who is writing. The judge has one stored value and neither, so the function would
 * answer about an entry that does not exist, and a value it refused there would be cleared under
 * a consent. It judges the value at the entry's next write, as it does for any rule added to a
 * field whose type stays.
 */
function withoutOwnValidate<C extends { to: FieldDefinition }>(change: C): C {
  // `validate` is declared on the shape the validator reads (`ValidatableField`), not on the
  // stored definition, so the field is read through that shape to find and leave it out.
  const field: FieldDefinition & Pick<ValidatableField, "validate"> = change.to;
  if (typeof field.validate !== "function") return change;
  const { validate: _left, ...to } = field;
  return { ...change, to };
}

/** The rows a reason names, as one text, so two reasons naming the same rows compare equal. */
const rowsText = (reason: ConversionJudgement["reasons"][number]) =>
  `${String(reason.rows?.count ?? 0)}:${(reason.rows?.first ?? []).map(rowKeyText).join(",")}`;

/**
 * Two verdicts on one column as one: the worse class, every reason, and each cleared row once.
 * A reason of `b` is left out where `a` already gives one of the same class for the same rows:
 * the two rules then say one thing of those rows in two words (a text that is no number is
 * "kept unreadable" to one and "not a number" to the other), and it is said once, as before.
 */
function worseOf(a: ColumnVerdict, b: ColumnVerdict | null): ColumnVerdict {
  if (b === null) return a;
  const cleared = new Map(
    [...a.cleared, ...b.cleared].map(key => [rowKeyText(key), key])
  );
  const said = new Set(
    a.judgement.reasons.map(reason => `${reason.class}:${rowsText(reason)}`)
  );
  return {
    judgement: {
      class:
        RANK[b.judgement.class] > RANK[a.judgement.class]
          ? b.judgement.class
          : a.judgement.class,
      reasons: [
        ...a.judgement.reasons,
        ...b.judgement.reasons.filter(
          reason =>
            reason.rows === undefined ||
            !said.has(`${reason.class}:${rowsText(reason)}`)
        ),
      ],
    },
    cleared: [...cleared.values()],
  };
}

/**
 * One column's type change judged over the rows it holds: by the repair command's rule, and, where
 * `fieldReadings` is given, by what the new field reads from each value too, the worse of the two
 * standing. The one judgement of an offered type change: the classifier asks it before anything
 * runs, and the apply asks it again, on the rows as they are then, before it clears a value.
 */
export async function judgeOfferedTypeChange(
  db: unknown,
  dialect: SupportedDialect,
  at: { table: string; column: string; keyedBy: KeyedBy },
  conversion: ColumnConversion,
  fieldReadings?: FieldReadings
): Promise<ColumnVerdict> {
  const cleared: RowKey[] = [];
  const judgement = await judgeStoredColumn(db, conversion, at, {
    noteRow: (kind, key) => {
      if (reasonClass(kind) === "lossy") cleared.push(key);
    },
  });
  // A pair the column rule has no conversion for is offered as such, whatever its values hold.
  if (
    fieldReadings === undefined ||
    judgement.reasons.some(reason => reason.kind === "no-conversion")
  ) {
    return { judgement, cleared };
  }
  const verdict = worseOf(
    { judgement, cleared },
    await fieldVerdict(db, dialect, at.table, fieldReadings)
  );
  return withRepeatsAcrossColumns(
    db,
    at,
    conversion.to.type,
    await withRepeatsToClear(db, dialect, at, verdict, fieldReadings),
    fieldReadings
  );
}

/**
 * `verdict`, blocked for `repeated`: rows a unique index would hold the same value in twice.
 *
 * @param count how many rows repeat, where `repeated` names only the first of them
 */
function blockedForRepeats(
  verdict: ColumnVerdict,
  repeated: readonly RowKey[],
  count: number = repeated.length
): ColumnVerdict {
  if (repeated.length === 0) return verdict;
  return {
    judgement: {
      class: "blocked",
      reasons: [
        ...verdict.judgement.reasons,
        {
          kind: "repeated",
          class: reasonClass("repeated"),
          rows: {
            first: repeated.slice(0, AFFECTED_ROWS_BOUND),
            count: Math.max(count, repeated.length),
          },
        },
      ],
    },
    cleared: verdict.cleared,
  };
}

/**
 * `verdict`, blocked where a unique index of several columns would hold one set of values twice
 * once SQLite's rebuild has kept each as its new type (`rebuiltIndexRepeats`): "1" and " 1" are
 * two texts and one number, so two rows that differ only there become one set to an index of this
 * column and another. Every column of the index is compared as the rebuild keeps it, so another
 * of its columns changing type in the same apply is compared at its new type too.
 *
 * The rebuild makes the index after copying every value, so such a set ends the apply with the
 * table already rebuilt. It is refused before any statement, naming the rows.
 *
 * @param type the column's type once the table is rebuilt
 */
async function withRepeatsAcrossColumns(
  db: unknown,
  at: { table: string; column: string; keyedBy: KeyedBy },
  type: string,
  verdict: ColumnVerdict,
  readings: FieldReadings
): Promise<ColumnVerdict> {
  if (at.keyedBy !== "id") return verdict;
  const repeated = new Map<string, RowKey>();
  let count = 0;
  for (const others of readings.uniqueWith ?? []) {
    const found = await rebuiltIndexRepeats(
      db,
      at.table,
      [{ column: at.column, type }, ...others],
      AFFECTED_ROWS_BOUND
    );
    found.first.forEach(key => repeated.set(rowKeyText(key), key));
    count = Math.max(count, found.count);
  }
  return blockedForRepeats(verdict, [...repeated.values()], count);
}

/**
 * `verdict`, blocked where the new column is unique and two values it would clear are the same.
 *
 * SQLite clears a consented value only once its table's rebuild has succeeded, and the rebuild
 * copies every value into the new column first. Two equal values copied into a unique column end
 * the rebuild part-way, before either is cleared, so the change is refused before any statement
 * runs, naming the rows. Values that all differ are copied and then cleared. PostgreSQL and MySQL
 * clear the consented values before the column converts, so two of them never meet in it there.
 */
async function withRepeatsToClear(
  db: unknown,
  dialect: SupportedDialect,
  at: { table: string; column: string; keyedBy: KeyedBy },
  verdict: ColumnVerdict,
  readings: FieldReadings
): Promise<ColumnVerdict> {
  if (
    dialect !== "sqlite" ||
    readings.unique !== true ||
    verdict.cleared.length < 2
  ) {
    return verdict;
  }
  const toClear = new Set(verdict.cleared.map(rowKeyText));
  const holders = new Map<string, RowKey[]>();
  for await (const value of readStoredValues(db, dialect, {
    ...at,
    toJson: false,
  })) {
    if (value.text === null || !toClear.has(rowKeyText(value.key))) continue;
    holders.set(value.text, [...(holders.get(value.text) ?? []), value.key]);
  }
  return blockedForRepeats(
    verdict,
    [...holders.values()].filter(keys => keys.length > 1).flat()
  );
}

/**
 * The other columns of each unique index of several columns that `column` of `table` is one of,
 * as the live table names them, each with its type once the table is rebuilt. An index over part
 * of the table's rows is left out: which rows it holds is the database's to say. So is one naming
 * a column the live table does not have yet: the apply adds it holding no value in any row, and a
 * row with no value repeats nothing.
 */
function indexedWith(
  table: TableSpec,
  live: TableSpec,
  column: string
): IndexedColumn[][] {
  const same = (name: string) => name.toLowerCase() === column.toLowerCase();
  const asRebuilt = (name: string): IndexedColumn | undefined => {
    const now = byName(live.columns, name);
    const next = byName(table.columns, name);
    return now === undefined || next === undefined
      ? undefined
      : { column: now.name, type: next.type };
  };
  return (table.indexes ?? [])
    .filter(
      index =>
        index.unique &&
        index.where === undefined &&
        index.columns.length > 1 &&
        index.columns.some(same)
    )
    .map(index => index.columns.filter(name => !same(name)).map(asRebuilt))
    .filter((indexed): indexed is IndexedColumn[] =>
      indexed.every(one => one !== undefined)
    );
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
  // The pipeline's one answer to which columns the applied schema makes unique, a declared index
  // of one column among them: a field's own flag is only one of its two sources.
  const isUnique = uniqueColumnLookup(args.expected, args.schema);
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
    const field = fieldOf(
      args.schema,
      op.tableName,
      op.columnName,
      args.dialect
    );
    const conversion = conversionOf(op, live, expected, field, args.dialect);
    const fieldReadings = fieldReadingsOf(
      args.schema,
      op.tableName,
      field,
      isUnique(op.tableName, op.columnName),
      // Only SQLite's rebuild lands before a unique index of several columns is made: elsewhere
      // the database refuses the conversion, and the statement changes nothing.
      // A change the rebuild converts by a rule of its own (`op.conversion`) writes values the copy
      // alone would not, so only a plain copy is compared.
      args.dialect === "sqlite" && op.conversion === undefined
        ? indexedWith(expectedTable, liveTable, expected.name)
        : []
    );
    const { judgement, cleared } = await judgeOfferedTypeChange(
      args.db,
      args.dialect,
      { table: liveTable.name, column: live.name, keyedBy },
      conversion,
      fieldReadings
    );
    return {
      judgement,
      keyedBy,
      cleared,
      conversion,
      ...(fieldReadings !== undefined ? { fieldReadings } : {}),
    };
  };
}
