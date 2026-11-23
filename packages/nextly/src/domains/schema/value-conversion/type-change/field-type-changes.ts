/**
 * The one judgement of a save's field type changes, which every road that changes a schema asks:
 * the fields whose type a save changes (`fieldTypeChangesOf`), each judged over the values its
 * column holds (`judgeFieldTypeChanges`), and the refusal a blocked change, or a lossy one the
 * owner has not consented to, gives (`typeChangeRefusals`). Every road asks it as a precondition,
 * before its first statement: the push (`pipeline/ui-type-changes`), the writer and a Single's save.
 *
 * @module domains/schema/value-conversion/type-change/field-type-changes
 */
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../../errors/nextly-error";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  isFieldLocalized,
  resolveLocalizedFieldNames,
} from "../../../i18n/classify-fields";
import { ddlType } from "../../../i18n/migration/ddl-types";
import { fieldToLocalizedColumnSpec } from "../../../i18n/migration/field-to-column-spec";
import { storesPerLanguage } from "../../../i18n/per-language-storage";
import { querySqlRows } from "../../pipeline/classifier/count-helpers";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  type ColumnOrigin,
  fieldsStoredOnRow,
  type SupportedDialect,
} from "../../services/field-column-descriptor";
import { describeClassed } from "../describe";
import type { RowKey } from "../types";

import {
  columnDescriptorAt,
  type Family,
  type FieldTypeOnDialect,
  fieldTypeOnDialect,
} from "./field-type";
import {
  FIRST_KEYS,
  fieldAccepts,
  judgeStoredTypeChange,
  type StoredTypeChangeJudgement,
  uniqueValues,
} from "./judge-stored";

/** One field whose type a save changes, read as the rules read both types on one database. */
export interface FieldTypeChange {
  /** The field as the save leaves it. */
  to: FieldDefinition;
  /** The field as the database holds it before the save. */
  from: FieldDefinition;
  fromType: FieldTypeOnDialect;
  toType: FieldTypeOnDialect;
}

/**
 * Whether two readings of a field are the same type for the rules: the family, the type's name,
 * and what decides a value's stored form (a number's format, a list's items, how a relationship
 * keeps its links). A column's width alone is not a type change; a one-to-one becoming many-to-one
 * keeps its links one per row, so it is not one either.
 */
function sameType(a: FieldTypeOnDialect, b: FieldTypeOnDialect): boolean {
  return (
    a.family === b.family &&
    a.type === b.type &&
    JSON.stringify(a.number) === JSON.stringify(b.number) &&
    sameItem(a.item, b.item) &&
    a.relation?.kept === b.relation?.kept
  );
}

/** A list's item type read by the same rule as the field's own: none on either side, or the same. */
function sameItem(
  a: FieldTypeOnDialect | undefined,
  b: FieldTypeOnDialect | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameType(a, b);
}

/**
 * The fields whose type a save changes, each paired with the field the database holds by its name,
 * or by the name a rename gives it. Only a field with a column before and after the save: one whose
 * values its column keeps and the new type then reads. A field that loses its column (a
 * relationship turned many-to-many, kept in a junction table) or gains one is a drop or an add,
 * which the save asks about as such.
 *
 * @param renamed the new name of each field the save renames, keyed by its old name
 */
export function fieldTypeChangesOf(args: {
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  renamed?: ReadonlyMap<string, string>;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  /**
   * The creator of the table the previous fields' columns were made by, where it is not
   * `builtBy`'s: an entity whose ownership the change moves between the Schema Builder and code
   * has its old columns as the old owner made them.
   */
  builtByBefore?: ColumnOrigin;
  /** Whether the fields are kept on a field group's row (`columnDescriptorAt`). */
  componentRow?: boolean;
}): FieldTypeChange[] {
  const at = {
    builtBy: args.builtBy,
    ...(args.componentRow === true ? { componentRow: true } : {}),
  };
  const atBefore = { ...at, builtBy: args.builtByBefore ?? args.builtBy };
  const oldNameOf = new Map(
    [...(args.renamed ?? new Map<string, string>())].map(([from, to]) => [
      to,
      from,
    ])
  );
  // The fields kept on the row: a field inside a group with no name is one of them, by its own name.
  const byName = new Map(
    fieldsStoredOnRow(args.previous).map(field => [field.name, field])
  );
  const changes: FieldTypeChange[] = [];
  for (const to of fieldsStoredOnRow(args.next)) {
    const from = byName.get(oldNameOf.get(to.name) ?? to.name);
    if (from === undefined) continue;
    const columnBefore = columnDescriptorAt(from, args.dialect, atBefore);
    const columnAfter = columnDescriptorAt(to, args.dialect, at);
    if (columnBefore === null || columnAfter === null) continue;
    const fromType = fieldTypeOnDialect(
      from,
      args.dialect,
      atBefore.builtBy,
      atBefore
    );
    const toType = fieldTypeOnDialect(to, args.dialect, args.builtBy, at);
    // Where the entity changes owner, one field type is made as two columns (the Builder's
    // unbounded text, code's bounded one on MySQL): the column the new owner makes is a change too,
    // which the judgement of its values, reading each one's bound, then weighs.
    const columnChanges =
      args.builtByBefore !== undefined &&
      columnBefore.dialectType !== columnAfter.dialectType;
    if (!sameType(fromType, toType) || columnChanges) {
      changes.push({ to, from, fromType, toType });
    }
  }
  return changes;
}

/** One field's type change judged over the values its column holds. */
export interface JudgedFieldTypeChange extends FieldTypeChange {
  table: string;
  column: string;
  result: StoredTypeChangeJudgement;
  /**
   * The field is kept per language before the save and after it (`translatedAfter`), and its
   * column in the entity's translations table takes another type that the save's or file's own
   * statements do not give it (`retyped`): a column a type change leaves in the old type, values or
   * none (`typeChangeRefusals`). A field the save stops translating, or
   * whose entity it stops translating, is not: its values leave that table, and the save's own
   * check of a field leaving translation answers for them. Nor is one whose translations column
   * keeps its type (a long text becoming code), which that column holds as it is.
   */
  changesTranslationsColumn?: true;
  /**
   * The field's entity stops being translated in the same save, while the field itself still asks
   * to be: its values leave the translations table, each language's as it is stored, before the
   * entity's own table takes the new type, which PostgreSQL refuses part-way (`typeChangeRefusals`).
   * A field that alone stops being translated is the save's check of a field leaving translation.
   */
  leavesWithEntity?: true;
  /**
   * Each kept or changed value as the new type reads it, by row, where the save rewrites the
   * values (`rewrites`): what the save's conversion writes. Absent where the database's cast is
   * left to reach them.
   */
  readings?: readonly { key: RowKey; readsAs: string }[];
  /**
   * The save writes this change's values itself, as the new type reads them (`rewrites`), here and
   * in the migration file that deploys it, so no database's cast is left to reach them: a value
   * that cannot convert is cleared where the person confirmed it, never refused as undeployable.
   */
  converted?: true;
}

/**
 * The families a save that rewrites the values converts between (`rewrites`): a text, an email, a
 * choice or a number from any of those, and a list into one of them, its one item. Any other pair
 * keeps the answer the database's cast gives, so a change this conversion does not write is judged
 * exactly as before, never written half way.
 */
const REWRITTEN_FROM: ReadonlySet<Family> = new Set([
  "text",
  "email",
  "choice",
  "number",
  "list",
]);
const REWRITTEN_TO: ReadonlySet<Family> = new Set([
  "text",
  "email",
  "choice",
  "number",
]);

/**
 * What the stored-value judgement is asked to hand over: each value's reading, gathered into
 * `readings`, where a unique MySQL text weighs them after the scan (`collated`) or the save writes
 * them (`rewritten`); and, for the latter, that it judges the values as rewritten.
 */
function readingOptions(
  collated: boolean,
  rewritten: boolean,
  readings: { key: RowKey; readsAs: string }[]
): { onReading?: (key: RowKey, readsAs: string) => void; rewrites?: true } {
  return {
    ...(collated || rewritten
      ? {
          onReading: (key: RowKey, readsAs: string) =>
            readings.push({ key, readsAs }),
        }
      : {}),
    ...(rewritten ? { rewrites: true as const } : {}),
  };
}

/** Whether a save that rewrites the values writes `from`'s values as `to` reads them. */
function rewritesPair(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): boolean {
  return REWRITTEN_FROM.has(from.family) && REWRITTEN_TO.has(to.family);
}

/**
 * Each change judged over its column: on the entity's table, or on its translations table, where
 * each language's value is its own row. The table the old definition keeps the value in is asked
 * first and the other after, so a save that also turns translation on or off reads each value where
 * it is. Each kept or changed value is asked of the new field's own validation too. A change whose
 * old column neither table has holds no value to judge, as where a save refused part-way already
 * took it (SQLite rebuilds a table to change a column), and is left out.
 *
 * @param translated the names of the fields kept per language before the save
 */
export async function judgeFieldTypeChanges(args: {
  db: unknown;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  /** Whether the fields are kept on a field group's row (`columnDescriptorAt`). */
  componentRow?: boolean;
  table: string;
  translationsTable?: string;
  translated?: ReadonlySet<string>;
  /** The names of the fields kept per language after the save: none where absent. */
  translatedAfter?: ReadonlySet<string>;
  /** The fields whose translations column the road's own statements retype (`retypedTranslations`). */
  retyped?: ReadonlySet<string>;
  changes: readonly FieldTypeChange[];
  /**
   * The save rewrites each value of a pair it converts (`rewritesPair`) as the new type reads it,
   * so each change of such a pair is judged that way and hands over its readings.
   */
  rewrites?: boolean;
}): Promise<JudgedFieldTypeChange[]> {
  const judged: JudgedFieldTypeChange[] = [];
  const columnsOf = liveColumnReader(args.db, args.dialect);
  const textOf = tableTextReader(args.db, args.dialect);
  for (const change of args.changes) {
    const held = await whereHeld(change, args, columnsOf);
    if (held === undefined) continue;
    const { table, column } = held;
    const perLanguage = table === args.translationsTable;
    const text = await textOf(table);
    // A unique MySQL text compares values by its collation, which only the database can weigh:
    // the readings are gathered and weighed after the scan instead of compared as they come.
    const collated =
      text !== undefined &&
      change.to.unique === true &&
      COLLATED_FAMILIES.has(change.toType.family);
    const readings: { key: RowKey; readsAs: string }[] = [];
    const rewritten =
      args.rewrites === true && rewritesPair(change.fromType, change.toType);
    const judgedHere = await judgeStoredTypeChange({
      db: args.db,
      dialect: args.dialect,
      table,
      column,
      keyedBy: perLanguage ? "translation" : "id",
      from: change.fromType,
      // A MySQL text column counts its bytes in the table's character set, which a column the
      // change converts takes.
      to: withCharset(change.toType, text?.charset),
      accepts: fieldAccepts(change.toType, change.to),
      // A unique field holds each value once: two that read as one value of the new type block.
      unique: change.to.unique === true && !collated,
      ...readingOptions(collated, rewritten, readings),
    });
    const result =
      collated && text !== undefined
        ? withRepeats(
            judgedHere,
            await repeatsByCollation(args.db, readings, text)
          )
        : judgedHere;
    judged.push({
      ...change,
      table,
      column,
      result,
      ...(perLanguage ? translationsTableFlags(change, args) : {}),
      ...(rewritten ? { readings, converted: true as const } : {}),
    });
  }
  return judged;
}

/**
 * What a change judged in the entity's translations table means for that table: its column takes
 * another type while the field stays translated (`changesTranslationsColumn`), or the entity stops
 * being translated while the field still asks to be (`leavesWithEntity`).
 */
function translationsTableFlags(
  change: FieldTypeChange,
  args: {
    dialect: SupportedDialect;
    builtBy: ColumnOrigin;
    translatedAfter?: ReadonlySet<string>;
    retyped?: ReadonlySet<string>;
  }
): Pick<
  JudgedFieldTypeChange,
  "changesTranslationsColumn" | "leavesWithEntity"
> {
  if (args.translatedAfter === undefined) return {};
  if (args.translatedAfter.has(change.to.name)) {
    // A column the save's or file's own statements give the new type is no column left behind:
    // its values are judged in each language, as the entity's own column's are.
    return translationsColumnChanges(change.from, change.to, args.builtBy) &&
      args.retyped?.has(change.to.name) !== true
      ? { changesTranslationsColumn: true }
      : {};
  }
  return isFieldLocalized(change.to, true) ? { leavesWithEntity: true } : {};
}

/**
 * A translated field's column type in the entity's translations table, as that table's creator
 * types it (`fieldToLocalizedColumnSpec`); null for a field it gives no column.
 */
/** Every database the translations table is made on: a migration file deploys to any of them. */
const DEPLOYED_DIALECTS: readonly SupportedDialect[] = [
  "sqlite",
  "postgresql",
  "mysql",
];

/**
 * Whether a translated field's column in the entity's translations table takes another type, on
 * any database its migration deploys to, not only the one the save runs on: a checkbox becoming a
 * number keeps SQLite's integer column but not PostgreSQL's boolean or MySQL's tinyint, so the
 * file a SQLite save writes would leave those in the old type. A long text becoming code keeps its
 * column on all three.
 */
export function translationsColumnChanges(
  from: FieldDefinition,
  to: FieldDefinition,
  builtBy: ColumnOrigin
): boolean {
  return DEPLOYED_DIALECTS.some(
    dialect =>
      translationsColumnType(from, { dialect, builtBy }) !==
      translationsColumnType(to, { dialect, builtBy })
  );
}

function translationsColumnType(
  field: FieldDefinition,
  args: { dialect: SupportedDialect; builtBy: ColumnOrigin }
): string | null {
  const spec = fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
  return spec === null ? null : ddlType(spec, args.dialect);
}

/**
 * The table and column a change's stored values are in. The table the old definition keeps the
 * value in is asked first, then the other: a save that turns translation on or off has each value
 * where it was, which the column's presence tells. The old field's column first, then the new
 * one's: a MySQL apply refused part-way can have committed a rename and not the type change after
 * it, which leaves the old values under the new name. Undefined where neither table has either.
 */
async function whereHeld(
  change: FieldTypeChange,
  args: {
    dialect: SupportedDialect;
    builtBy: ColumnOrigin;
    componentRow?: boolean;
    table: string;
    translationsTable?: string;
    translated?: ReadonlySet<string>;
  },
  columnsOf: (table: string) => Promise<ReadonlySet<string>>
): Promise<{ table: string; column: string } | undefined> {
  const tables = [args.table, args.translationsTable].filter(
    (t): t is string => t !== undefined
  );
  if (args.translated?.has(change.from.name) === true) tables.reverse();
  const columns = [change.from, change.to]
    .map(field => columnDescriptorAt(field, args.dialect, args)?.name)
    .filter((name): name is string => name !== undefined);
  for (const column of columns) {
    for (const table of tables) {
      if ((await columnsOf(table)).has(column.toLowerCase())) {
        return { table, column };
      }
    }
  }
  return undefined;
}

/** Each table's column names, lower-cased, read from the database once per table. */
function liveColumnReader(
  db: unknown,
  dialect: SupportedDialect
): (table: string) => Promise<ReadonlySet<string>> {
  const read = new Map<string, Promise<ReadonlySet<string>>>();
  return table => {
    let columns = read.get(table);
    if (columns === undefined) {
      columns = introspectLiveSnapshot(db, dialect, [table]).then(
        live =>
          new Set(
            (
              live.tables.find(
                t => t.name.toLowerCase() === table.toLowerCase()
              )?.columns ?? []
            ).map(c => c.name.toLowerCase())
          )
      );
      read.set(table, columns);
    }
    return columns;
  };
}

/** A MySQL table's default text rule: its character set and collation, as MySQL names them. */
interface TableText {
  charset: string;
  collation: string;
}

/**
 * Each MySQL table's default character set and collation, read from the database once per table:
 * what a text column the change converts counts its bytes in, and how a unique index on it compares
 * two values. Undefined on PostgreSQL and SQLite, whose text holds any length and whose default
 * collations compare values exactly, and where the table is not found.
 */
function tableTextReader(
  db: unknown,
  dialect: SupportedDialect
): (table: string) => Promise<TableText | undefined> {
  const read = new Map<string, Promise<TableText | undefined>>();
  return table => {
    if (dialect !== "mysql") return Promise.resolve(undefined);
    let text = read.get(table);
    if (text === undefined) {
      text = querySqlRows<{ charset: unknown; collation: unknown }>(
        db,
        dialect,
        sql`SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION AS collation FROM information_schema.TABLES t JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = ${table}`
      ).then(([row]) =>
        typeof row?.charset === "string" && typeof row.collation === "string"
          ? { charset: row.charset, collation: row.collation }
          : undefined
      );
      read.set(table, text);
    }
    return text;
  };
}

/** The new types a unique MySQL index compares by its collation: those kept as text. */
const COLLATED_FAMILIES = new Set<FieldTypeOnDialect["family"]>([
  "text",
  "email",
  "choice",
]);

/** How many readings one weighing query asks about. */
const WEIGH_AT_ONCE = 500;

/** A MySQL character set's or collation's name, which is spelled into the weighing query. */
const MYSQL_NAME = /^[A-Za-z0-9_]+$/;

/**
 * The rows whose reading a unique index in `text`'s collation holds as another row's in the same
 * language (`uniqueValues`, over each reading's collation weight): MySQL's weight of each value,
 * asked a few hundred at a time, so "A" and "a" are one value under a case-insensitive collation.
 */
async function repeatsByCollation(
  db: unknown,
  readings: readonly { key: RowKey; readsAs: string }[],
  text: TableText
): Promise<RowKey[]> {
  if (!MYSQL_NAME.test(text.charset) || !MYSQL_NAME.test(text.collation)) {
    throw NextlyError.internal({
      logContext: {
        reason: "a MySQL table names an unexpected collation",
        text,
      },
    });
  }
  const repeatsOf = uniqueValues();
  const repeated: RowKey[] = [];
  for (let at = 0; at < readings.length; at += WEIGH_AT_ONCE) {
    const batch = readings.slice(at, at + WEIGH_AT_ONCE);
    const rows = await querySqlRows<{ i: unknown; w: unknown }>(
      db,
      "mysql",
      sql.join(
        batch.map(
          (reading, i) =>
            sql`SELECT ${i} AS i, HEX(WEIGHT_STRING(CONVERT(${reading.readsAs} USING ${sql.raw(text.charset)}) COLLATE ${sql.raw(text.collation)})) AS w`
        ),
        sql` UNION ALL `
      )
    );
    const weights = new Map(rows.map(row => [Number(row.i), String(row.w)]));
    batch.forEach((reading, i) => {
      const found = repeatsOf(reading.key, weights.get(i) ?? reading.readsAs);
      if (found !== undefined) repeated.push(...found);
    });
  }
  return repeated;
}

/** `result` with the rows a unique field would hold twice, which block the change (`repeated`). */
function withRepeats(
  result: StoredTypeChangeJudgement,
  repeated: readonly RowKey[]
): StoredTypeChangeJudgement {
  if (repeated.length === 0) return result;
  return {
    ...result,
    judgement: {
      class: "blocked",
      reasons: [
        ...result.judgement.reasons,
        {
          kind: "repeated",
          class: "blocked",
          rows: {
            first: repeated.slice(0, FIRST_KEYS),
            count: repeated.length,
          },
        },
      ],
    },
  };
}

/** A type whose byte-bounded text, its own or its items', is counted in `charset`. */
function withCharset(
  type: FieldTypeOnDialect,
  charset: string | undefined
): FieldTypeOnDialect {
  if (charset === undefined) return type;
  const bound = type.textBound;
  return {
    ...type,
    ...(bound?.unit === "bytes" ? { textBound: { ...bound, charset } } : {}),
    ...(type.item !== undefined
      ? { item: withCharset(type.item, charset) }
      : {}),
  };
}

/** One refusal of a save's field type change, as a validation error lists it. */
export interface TypeChangeRefusal {
  path: string;
  code: "TYPE_CHANGE_BLOCKED" | "TYPE_CHANGE_LOSES_VALUES";
  message: string;
}

/**
 * Why a value the database's cast does not reach cannot be rewritten or cleared by the change:
 * the migration that deploys it to every other database (`nextly migrate`) converts by that cast,
 * so a database it reaches would hold what the cast gives, not what the change gave here.
 */
const DEPLOYED_BY_CAST =
  "the migration that deploys a type change converts each value by the database's cast";

/**
 * The refusals a save's judged type changes give: each blocked one, each lossy one whose field the
 * owner has not consented to clearing values of (`acknowledged`, by field path), and each change
 * of a field kept per language whose translations column takes another type
 * (`changesTranslationsColumn`): that column keeps the old type, so each language's value, and each
 * written after, would stay of the old type, held or not; and each change of a field whose entity
 * stops being translated in the same save (`leavesWithEntity`), whose values leave that table as
 * they are stored. A translated change is blocked whatever
 * its values, so its refusal names that reason beside theirs, and the person is not sent to fix
 * values first. Each names the field and both types, and every reason with its rows, by key and
 * never by value; says why a value the cast does not reach cannot be deployed yet; and says that
 * a new field of the new type keeps the old values beside the new ones.
 */
export function typeChangeRefusals(
  entity: string,
  judged: readonly JudgedFieldTypeChange[],
  acknowledged: ReadonlySet<string> = new Set()
): TypeChangeRefusal[] {
  const refusals: TypeChangeRefusal[] = [];
  for (const change of judged) {
    const refusal = refusalOf(entity, change, acknowledged);
    if (refusal !== null) refusals.push(refusal);
  }
  return refusals;
}

/** One judged change's refusal, as `typeChangeRefusals` describes it; null where it goes ahead. */
function refusalOf(
  entity: string,
  change: JudgedFieldTypeChange,
  acknowledged: ReadonlySet<string>
): TypeChangeRefusal | null {
  const { judgement } = change.result;
  const blocked = judgement.class === "blocked";
  const lossy =
    judgement.class === "lossy" && !acknowledged.has(change.to.name);
  // A cleared value is no value, which a required field's column refuses: the clear is refused
  // even confirmed, rather than written part way into a NOT NULL that stops it.
  const clearsRequired =
    judgement.class === "lossy" &&
    acknowledged.has(change.to.name) &&
    change.to.required === true;
  const translated = change.changesTranslationsColumn === true;
  const leaving = change.leavesWithEntity === true;
  if (!blocked && !lossy && !clearsRequired && !translated && !leaving) {
    return null;
  }
  const why = refusalReasons({
    translated,
    leaving,
    lossy,
    clearsRequired,
    rewritten: judgement.reasons.some(r => r.kind === "needs-rewrite"),
    converted: change.converted === true,
  });
  const values =
    blocked || lossy || clearsRequired
      ? ` (${describeClassed(judgement)})`
      : "";
  return {
    path: change.to.name,
    code:
      blocked || translated || leaving
        ? "TYPE_CHANGE_BLOCKED"
        : "TYPE_CHANGE_LOSES_VALUES",
    message: [
      `${entity}: field '${change.to.name}' cannot change from ${change.from.type} to ${change.to.type}${values}.`,
      ...why,
      "A new field of the new type keeps the old values beside the new ones.",
    ].join(" "),
  };
}

/**
 * Why a refused change can't go ahead as it stands, beyond its values' own reasons: its translations
 * column, its entity leaving translation, and a value the deploying cast would not clear or rewrite.
 * A change the save converts itself (`converted`) is deployed by its own file, so a value it would
 * clear waits only for the person's confirmation.
 */
function refusalReasons(of: {
  translated: boolean;
  leaving: boolean;
  lossy: boolean;
  clearsRequired: boolean;
  rewritten: boolean;
  converted: boolean;
}): string[] {
  const why: string[] = [];
  if (of.translated) {
    why.push(
      "It is kept per language, in a translations table whose column a type change does not convert, so the change can't be deployed yet."
    );
  }
  if (of.leaving) {
    why.push(
      "Its entity stops being translated in the same save, which moves each language's value out of the translations table as it is stored: turn off translation and save first, then change the field's type."
    );
  }
  if (of.clearsRequired) {
    why.push(
      "It is required, so a cleared value would leave its row with none: make it optional first, or change the values that cannot convert, then save again."
    );
  } else if (of.lossy && of.converted) {
    why.push(
      "Confirm clearing the values that cannot convert, with the count the review shows, and the save clears them, here and on every database its migration deploys to."
    );
  } else if (of.lossy) {
    why.push(
      `Clearing the values that cannot convert can't be deployed yet: ${DEPLOYED_BY_CAST}.`
    );
  } else if (of.rewritten && !of.converted) {
    why.push(
      `Rewriting values into the new type's form can't be deployed yet: ${DEPLOYED_BY_CAST}.`
    );
  }
  return why;
}

/** The registry statuses whose recorded fields the database already has. */
const DEFINITION_APPLIED = new Set(["applied", "synced"]);

/**
 * The refusal of a save that changes a field's type while the entity's recorded definition still
 * awaits its migration (`migrationStatus` neither applied nor synced): its recorded fields describe
 * a future the columns do not hold yet, so no value can be judged against them. Null where nothing
 * changes type or the definition is the database's.
 */
export function pendingMigrationRefusal(
  entity: string,
  migrationStatus: string | null | undefined,
  changes: readonly FieldTypeChange[]
): TypeChangeRefusal | null {
  if (changes.length === 0) return null;
  if (DEFINITION_APPLIED.has(String(migrationStatus))) return null;
  return {
    path: changes[0].to.name,
    code: "TYPE_CHANGE_BLOCKED",
    message: `Finish the pending migration of ${entity} first, then change the field's type.`,
  };
}

/** How a refusal names each kind of entity a save changes. */
const KIND_LABEL = {
  collection: "Collection",
  single: "Single",
  fieldGroup: "Field group",
} as const;

/** How a refusal names an entity: "Collection 'products'", "Single 'home'". */
export function entityLabel(
  kind: keyof typeof KIND_LABEL,
  slug: string
): string {
  return `${KIND_LABEL[kind]} '${slug}'`;
}

/**
 * Where an entity's fields kept per language before a save have their values: its companion table,
 * for an entity stored per language (`storesPerLanguage`), with the fields its old definition
 * translates. Nothing for one that keeps every value on its main table.
 */
export function perLanguageBefore(
  entity: { localized?: unknown },
  table: string,
  previous: readonly FieldDefinition[]
): Pick<EntityTypeChangeInput, "translationsTable" | "translatedBefore"> {
  if (!storesPerLanguage(entity)) return {};
  return {
    translationsTable: `${table}_locales`,
    translatedBefore: new Set(
      resolveLocalizedFieldNames(fieldsStoredOnRow(previous), true)
    ),
  };
}

/**
 * The fields an entity keeps per language after a save: those its new definition translates, for
 * an entity stored per language after it (`storesPerLanguage`); none for one the save leaves, or
 * makes, untranslated, whatever its fields say.
 */
export function perLanguageAfter(
  entity: { localized?: unknown },
  next: readonly FieldDefinition[]
): Pick<EntityTypeChangeInput, "translatedAfter"> {
  return {
    translatedAfter: new Set(
      storesPerLanguage(entity)
        ? resolveLocalizedFieldNames(fieldsStoredOnRow(next), true)
        : []
    ),
  };
}

/** One entity a save changes, as the precondition reads it. */
export interface EntityTypeChangeInput {
  /** How a refusal names the entity: "Collection 'products'", "Single 'home'". */
  label: string;
  table: string;
  /** Its translations table, where a field translated before the save keeps each language's value. */
  translationsTable?: string;
  /** The fields translated before the save. */
  translatedBefore?: ReadonlySet<string>;
  /** The fields translated after the save (`perLanguageAfter`). */
  translatedAfter?: ReadonlySet<string>;
  /**
   * The fields, by their new name, whose translations column the road's own statements give the
   * new type: the save's file's or the deployed change's `retypes` statements. A translated change
   * is refused for its column only where it is not among them (`changesTranslationsColumn`).
   */
  retypedTranslations?: ReadonlySet<string>;
  /** The fields as the database holds them before the save: the registry row's. */
  previous: readonly FieldDefinition[];
  /** The fields as the save leaves them. */
  next: readonly FieldDefinition[];
  renamed?: ReadonlyMap<string, string>;
  /** The registry row's status: a definition still awaiting its migration is not judged against. */
  migrationStatus?: string | null;
  builtBy: ColumnOrigin;
  /** Whether the entity keeps its fields on a field group's rows (`columnDescriptorAt`). */
  componentRow?: boolean;
  /** The fields whose lost values the owner consented to clearing, by name. */
  acknowledged?: ReadonlySet<string>;
  /** Fields whose change another check answers for, by their new name: not judged here. */
  ignore?: ReadonlySet<string>;
  /** The creator of the entity's table before the change, where its ownership moves (`fieldTypeChangesOf`). */
  builtByBefore?: ColumnOrigin;
  /** The save rewrites the values of each pair it converts (`judgeFieldTypeChanges`' `rewrites`). */
  rewrites?: boolean;
}

/**
 * Every refusal of `entity`'s field type changes: each blocked one, each lossy one with no consent
 * naming its field, or the one refusal of any type change while the entity's definition still
 * awaits its migration. A save with no field type change reads no row.
 */
export async function fieldTypeChangeRefusals(
  db: unknown,
  dialect: SupportedDialect,
  entity: EntityTypeChangeInput
): Promise<TypeChangeRefusal[]> {
  return (await judgeEntityTypeChanges(db, dialect, entity)).refusals;
}

/**
 * `entity`'s field type changes judged over the values their columns hold, with the refusals they
 * give (`fieldTypeChangeRefusals`): a save that converts the values reads each one's readings and
 * the values it clears from the same judgement. None judged where the definition awaits its
 * migration, which is refused before any value is read.
 */
export async function judgeEntityTypeChanges(
  db: unknown,
  dialect: SupportedDialect,
  entity: EntityTypeChangeInput
): Promise<{
  refusals: TypeChangeRefusal[];
  judged: JudgedFieldTypeChange[];
}> {
  const changes = fieldTypeChangesOf({
    previous: entity.previous,
    next: entity.next,
    ...(entity.renamed !== undefined ? { renamed: entity.renamed } : {}),
    dialect,
    builtBy: entity.builtBy,
    ...(entity.builtByBefore !== undefined
      ? { builtByBefore: entity.builtByBefore }
      : {}),
    ...(entity.componentRow === true ? { componentRow: true } : {}),
  }).filter(change => entity.ignore?.has(change.to.name) !== true);
  if (changes.length === 0) return { refusals: [], judged: [] };
  const pending =
    entity.migrationStatus === undefined
      ? null
      : pendingMigrationRefusal(entity.label, entity.migrationStatus, changes);
  if (pending !== null) return { refusals: [pending], judged: [] };
  const judged = await judgeFieldTypeChanges({
    db,
    dialect,
    builtBy: entity.builtBy,
    ...(entity.componentRow === true ? { componentRow: true } : {}),
    table: entity.table,
    ...(entity.translationsTable !== undefined
      ? { translationsTable: entity.translationsTable }
      : {}),
    ...(entity.translatedBefore !== undefined
      ? { translated: entity.translatedBefore }
      : {}),
    ...(entity.translatedAfter !== undefined
      ? { translatedAfter: entity.translatedAfter }
      : {}),
    ...(entity.retypedTranslations !== undefined
      ? { retyped: entity.retypedTranslations }
      : {}),
    changes,
    ...(entity.rewrites === true ? { rewrites: true } : {}),
  });
  return {
    refusals: typeChangeRefusals(entity.label, judged, entity.acknowledged),
    judged,
  };
}

/** A refusal as a validation error lists it: by the field's path under `fields`. */
export function typeChangeError(refusal: TypeChangeRefusal): {
  path: string;
  code: string;
  message: string;
} {
  return {
    path: `fields.${refusal.path}`,
    code: refusal.code,
    message: refusal.message,
  };
}

/**
 * Refuse, before any statement of the save runs, every field type change of `entity` that is
 * blocked, or lossy with no consent naming its field, and any type change while the entity's
 * definition still awaits its migration (`fieldTypeChangeRefusals`). Every refusal is named at
 * once, so the owner sees them all in one save.
 *
 * @throws {NextlyError} a validation error listing each refusal by its field
 */
export async function refuseFieldTypeChanges(
  db: unknown,
  dialect: SupportedDialect,
  entity: EntityTypeChangeInput
): Promise<void> {
  throwTypeChangeRefusals(
    entity.label,
    await fieldTypeChangeRefusals(db, dialect, entity)
  );
}

/**
 * Throw `refusals` of `entity`'s type changes as one validation error, each by its field, where
 * there are any: every refusal at once, so the owner sees them all in one save.
 *
 * @throws {NextlyError} a validation error listing each refusal by its field
 */
export function throwTypeChangeRefusals(
  entity: string,
  refusals: readonly TypeChangeRefusal[]
): void {
  if (refusals.length === 0) return;
  throw NextlyError.validation({
    errors: refusals.map(typeChangeError),
    logContext: {
      entity,
      fields: refusals.map(refusal => refusal.path),
    },
  });
}
