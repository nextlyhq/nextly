/**
 * A type change carried out value by value: each kept or changed value written as the new type
 * reads it, and each value whose clearing was consented to written as no value, so no value reaches
 * the new type through the database's cast. Built from the judgement made before anything runs
 * (`judgeEntityTypeChanges` with `rewrites`), for the columns it converts (`converted`); every
 * other change is left to the cast, judged as before.
 *
 * It runs where the type change's own statements would, just before them, on the handle they run
 * on: in the transaction of the migration file that first changes the column, before its first
 * statement (`runUnitInTries`' `before`), on a Schema Builder save's own database and on each one
 * `nextly migrate` deploys the file to. A save its push applies converts nothing: the push's
 * statements run outside any transaction a conversion could share, so it keeps the cast. There
 * it judges every value it converts again, before any statement of its own: what was judged earlier
 * may have been written over since, so a value that now blocks the change, or a count of cleared
 * values other than the one consented to, refuses it with nothing changed (`run`). Only then are
 * the values written, read again a page at a time, so a table's values are never all held. Once
 * it has run the column already has its new type and its values, so the file's or the push's own
 * statement finds nothing left to change:
 * - on SQLite, where a column's type is an affinity, the readings are written into a column beside
 *   it, which the column then takes row by row, and the table's rebuild to the new type keeps them;
 * - on PostgreSQL the readings are written into a column of the new type made beside it, and the
 *   column takes its new type from that column (`ALTER … TYPE … USING`), in place, so its indexes
 *   and constraints stay;
 * - on MySQL, whose schema statements commit one by one, the readings are written into the column
 *   beside it, the column is emptied and given its new type (`MODIFY`), then takes the readings.
 *   The column beside it holds every value until the last step, and goes after it.
 *
 * Translated values are converted in each language's row of the translations table the same way.
 *
 * @module domains/schema/builder-save/type-conversion
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { ddlType } from "../../i18n/migration/ddl-types";
import { fieldToLocalizedColumnSpec } from "../../i18n/migration/field-to-column-spec";
import { runStatement } from "../pipeline/_internal/run-statement";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { readUpdateTriggers } from "../pipeline/live-table-facts";
import type { ColumnOrigin } from "../services/field-column-descriptor";
import { columnDescriptorAt } from "../value-conversion/type-change/field-type";
import {
  type EntityTypeChangeInput,
  judgeEntityTypeChanges,
  type JudgedFieldTypeChange,
  throwTypeChangeRefusals,
  typeChangeRefusals,
} from "../value-conversion/type-change/field-type-changes";
import type { Reading } from "../value-conversion/type-change/judge-stored";
import type { RowKey } from "../value-conversion/types";

import {
  type ConfirmedClear,
  clearedFieldsOf,
  refuseChangedClearCounts,
} from "./type-change-clears";

/** How many rows one statement writes, so a large table is written in a few statements. */
const ROWS_PER_STATEMENT = 200;

/** The column a conversion writes beside the one it converts, of the new type. */
const BESIDE = "__nextly_converted";

/**
 * How the road takes consent to clear the values that cannot convert:
 * - a save's review, by each field and the count of values it clears, which must still hold when
 *   the conversion runs (`refuseChangedClearCounts`);
 * - a run's consent, by the change, for a migration file deploying the change to a database whose
 *   own values no review counted (`--accept-data-loss`), with how the run's refusal asks for it.
 */
export type ClearConsent =
  | { kind: "review"; confirmed: readonly ConfirmedClear[] | undefined }
  | {
      kind: "run";
      covers: (change: JudgedFieldTypeChange) => boolean;
      clearsBy: (change: JudgedFieldTypeChange) => string;
    };

/** One column a conversion writes value by value. */
export interface ConvertedColumn {
  table: string;
  column: string;
  /** The field whose values it holds, by its new name. */
  field: string;
  /** The column's new type, as the database spells it. */
  type: string;
  /** How many values the judgement before the run found it writes as the new type reads them. */
  converted: number;
  /** How many values the judgement before the run found it clears. */
  cleared: number;
  /**
   * The column's table is rebuilt to the new type by nothing else on SQLite (a translations table,
   * which the push leaves out): the column beside, of the new type, takes its place there.
   */
  takesPlaceOnSqlite: boolean;
}

/** A type change's values converted one by one. */
export interface TypeConversion {
  /** The tables whose columns it converts. */
  readonly tables: readonly string[];
  /** The columns it converts, with how many values the judgement before the run clears. */
  readonly columns: readonly ConvertedColumn[];
  /**
   * Judges every column it converts again through `db`, the handle the change's statements run
   * on, refusing before any statement as the judgement before it would, then converts each.
   */
  readonly run: (db: unknown) => Promise<void>;
  /**
   * `run` for the columns of `changed`, the tables one migration file's statements change:
   * undefined where it converts none of them. Each file converts its own tables, in its own run.
   */
  readonly runIn: (
    changed: readonly string[]
  ) => ((db: unknown) => Promise<void>) | undefined;
}

/**
 * The conversion of the judged changes that convert their values (`converted`), or undefined where
 * none does, and the type changes are then the database's cast.
 *
 * @param input the entity's type changes as they were judged, judged again by the conversion
 * @param judged that judgement, which names the columns converted
 */
export function typeConversionOf(args: {
  dialect: SupportedDialect;
  input: EntityTypeChangeInput;
  judged: readonly JudgedFieldTypeChange[];
  consent: ClearConsent;
}): TypeConversion | undefined {
  const { dialect, input } = args;
  const columns: ConvertedColumn[] = args.judged.flatMap(change => {
    if (change.converted !== true) return [];
    const translations = change.table === input.translationsTable;
    const type = translations
      ? translationsColumnType(change.to, dialect, input.builtBy)
      : columnDescriptorAt(change.to, dialect, {
          builtBy: input.builtBy,
          ...(input.componentRow === true ? { componentRow: true } : {}),
        })?.dialectType;
    if (type === undefined) return [];
    return [
      {
        table: change.table,
        column: change.column,
        field: change.to.name,
        type,
        converted: change.result.counts.kept + change.result.counts.changed,
        cleared: change.result.cleared.length,
        takesPlaceOnSqlite: translations,
      },
    ];
  });
  if (columns.length === 0) return undefined;
  const runOf =
    (only: readonly ConvertedColumn[]) =>
    async (db: unknown): Promise<void> => {
      const plan = await judgedAgain(db, dialect, input, args.consent, only);
      for (const column of plan) {
        await convertColumn(db, dialect, {
          input,
          consent: args.consent,
          planned: column,
        });
      }
    };
  return {
    tables: [...new Set(columns.map(c => c.table))],
    columns,
    run: runOf(columns),
    runIn: changed => {
      const mine = columns.filter(c => changed.includes(c.table));
      return mine.length === 0 ? undefined : runOf(mine);
    },
  };
}

/** The codes of a type change's refusals, which a conversion's refusal carries every issue under. */
const REFUSAL_CODES: ReadonlySet<string> = new Set([
  "TYPE_CHANGE_BLOCKED",
  "TYPE_CHANGE_LOSES_VALUES",
  "TYPE_CHANGE_CLEAR_COUNT_CHANGED",
]);

/**
 * Whether `error` is a type change's refusal, such as a conversion gives before its first
 * statement (`TypeConversion.run`): a validation error whose every issue is a type change's. A
 * file's runner passes it through as it is, as it names the field and why, and nothing of the
 * conversion ran.
 */
export function isConversionRefusal(error: unknown): boolean {
  if (!NextlyError.isCode(error, "VALIDATION_ERROR")) return false;
  const issues = (
    error.publicData as { errors?: { code?: unknown }[] } | undefined
  )?.errors;
  return (
    issues !== undefined &&
    issues.length > 0 &&
    issues.every(
      issue => typeof issue.code === "string" && REFUSAL_CODES.has(issue.code)
    )
  );
}

/**
 * The refusals of `conversion`'s columns that need no judging of their values, asked before
 * anything of a save is written so the save refuses then, as it is again where the conversion
 * runs (`judgedAgain`): a column left by a conversion that stopped part-way, update triggers, and
 * on SQLite a translations column a view, trigger or condition depends on.
 *
 * @throws {NextlyError} a validation error naming each refusal
 */
export async function refuseConversionAsItStands(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  conversion: TypeConversion,
  judged: readonly JudgedFieldTypeChange[]
): Promise<void> {
  await refuseLeftColumns(db, dialect, label, conversion.columns);
  await refuseOverUpdateTriggers(
    db,
    dialect,
    label,
    judged.filter(change => change.converted === true)
  );
  if (dialect === "sqlite") {
    // The translations columns the conversion swaps; a REAL column it swaps is known where it runs.
    await refuseSqliteSwapDependents(
      db,
      label,
      conversion.columns.filter(column => column.takesPlaceOnSqlite)
    );
  }
}

/** A translated field's column type in its translations table, as that table's creator types it. */
function translationsColumnType(
  field: JudgedFieldTypeChange["to"],
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): string | undefined {
  const spec = fieldToLocalizedColumnSpec(field, dialect, builtBy);
  return spec === null ? undefined : ddlType(spec, dialect);
}

/**
 * The refusals of `judged` with the clearing `consent` gives (`typeChangeRefusals`): a review's
 * fields, or each converted change a run's consent covers that clears any value, worded as the
 * road asks for it. One reading of a consent, for the judgement before a run and the conversion's
 * own.
 */
export function consentedRefusals(
  label: string,
  judged: readonly JudgedFieldTypeChange[],
  consent: ClearConsent
): {
  acknowledged: ReadonlySet<string>;
  refusals: ReturnType<typeof typeChangeRefusals>;
} {
  if (consent.kind === "review") {
    const acknowledged = clearedFieldsOf(consent.confirmed);
    return {
      acknowledged,
      refusals: typeChangeRefusals(label, judged, acknowledged),
    };
  }
  // Only a change the conversion writes clears its values: a run's consent never lets a lossy
  // change the cast converts through, as the cast does not clear what it cannot read.
  const acknowledged = new Set(
    judged
      .filter(
        change =>
          change.converted === true &&
          change.result.cleared.length > 0 &&
          consent.covers(change)
      )
      .map(change => change.to.name)
  );
  return {
    acknowledged,
    refusals: typeChangeRefusals(label, judged, acknowledged, consent.clearsBy),
  };
}

/** One column as the conversion found it before its first statement, and what it consented to. */
interface PlannedColumn extends ConvertedColumn {
  /** The column's own definition, read before anything is written (`columnFactsOf`). */
  facts: ColumnFacts;
  /** The changes judged with it, consented to as the judgement before the writing was. */
  acknowledged: ReadonlySet<string>;
  /** On SQLite, the column beside takes its place (`swapsOnSqlite`). */
  swaps: boolean;
}

/**
 * The columns of `only` judged again through `db`, before any statement: each refusal the
 * judgement gives, with the clearing consented to as the road takes it (`ClearConsent`); a count
 * of cleared values other than the one a review confirmed; a column left by a conversion that
 * stopped part-way; a table whose rows fire update triggers, which the conversion's row-by-row
 * writes would set off (PostgreSQL's in-place change fires none, but its values are written into
 * the column beside it first); and on SQLite a translations column whose swap a view, a trigger
 * or an index on an expression or with a condition would stop part-way.
 *
 * @throws {NextlyError} a validation error naming each refusal, with nothing written
 */
async function judgedAgain(
  db: unknown,
  dialect: SupportedDialect,
  input: EntityTypeChangeInput,
  consent: ClearConsent,
  only: readonly ConvertedColumn[]
): Promise<PlannedColumn[]> {
  const isConverted = (table: string, column: string) =>
    only.some(c => c.table === table && c.column === column);
  const { judged } = await judgeEntityTypeChanges(db, dialect, input, {
    only: isConverted,
  });
  const { acknowledged, refusals } = consentedRefusals(
    input.label,
    judged,
    consent
  );
  throwTypeChangeRefusals(input.label, refusals);
  if (consent.kind === "review") {
    // The fields this pass judges, as each file converts its own tables.
    const fields = new Set(judged.map(change => change.to.name));
    refuseChangedClearCounts(
      judged,
      consent.confirmed?.filter(clear => fields.has(clear.field))
    );
  }
  await refuseLeftColumns(db, dialect, input.label, only);
  await refuseOverUpdateTriggers(db, dialect, input.label, judged);
  const planned: PlannedColumn[] = [];
  for (const change of judged) {
    const column = only.find(
      c => c.table === change.table && c.column === change.column
    );
    if (column === undefined) continue;
    const facts = await columnFactsOf(db, dialect, column.table, column.column);
    planned.push({
      ...column,
      cleared: change.result.cleared.length,
      facts,
      acknowledged,
      swaps: dialect === "sqlite" && swapsOnSqlite(column, facts),
    });
  }
  if (dialect === "sqlite") {
    await refuseSqliteSwapDependents(
      db,
      input.label,
      planned.filter(column => column.swaps)
    );
  }
  return planned;
}

/**
 * Whether, on SQLite, the column beside takes the converted column's place (`swapIn`) rather than
 * the column taking its values row by row: for a translations table, which no rebuild gives the
 * new type; and for a column whose REAL affinity would turn a text reading that looks like a number
 * back into one (a float number becoming a text keeps `34`, which the column would store as `34.0`
 * and the rebuild then copy as that text).
 */
function swapsOnSqlite(column: ConvertedColumn, facts: ColumnFacts): boolean {
  if (column.takesPlaceOnSqlite) return true;
  return realAffinity(facts.type) && textAffinity(column.type);
}

/** Whether a SQLite column of declared `type` has REAL affinity (SQLite's affinity rules). */
function realAffinity(type: string): boolean {
  const upper = type.toUpperCase();
  if (/INT|CHAR|CLOB|TEXT|BLOB/.test(upper)) return false;
  return /REAL|FLOA|DOUB/.test(upper);
}

/** Whether a SQLite column of declared `type` has TEXT affinity (SQLite's affinity rules). */
function textAffinity(type: string): boolean {
  const upper = type.toUpperCase();
  return !upper.includes("INT") && /CHAR|CLOB|TEXT/.test(upper);
}

/**
 * Refuse a conversion of a table that still has the column a conversion writes into (`BESIDE`):
 * one left by a conversion that stopped part-way, which may hold the only copy of a column's
 * values. Nothing is written over it; the person finishes or undoes that conversion first.
 */
async function refuseLeftColumns(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  only: readonly ConvertedColumn[]
): Promise<void> {
  const left: string[] = [];
  for (const table of new Set(only.map(c => c.table))) {
    for (const name of await columnNamesOf(db, dialect, table)) {
      if (name.startsWith(BESIDE)) left.push(`${table}.${name}`);
    }
  }
  if (left.length === 0) return;
  throw NextlyError.validation({
    errors: left.map(column => ({
      path: `columns.${column}`,
      code: "TYPE_CHANGE_BLOCKED",
      message: `${label}: ${column} was left by a type change that stopped part-way, and may hold the only copy of a column's values, so nothing was changed. Put those values back where they belong and drop the column, then try again.`,
    })),
    logContext: { reason: "type-change-left-columns", left },
  });
}

/**
 * Refuse a conversion of a table that has update triggers, naming them, before any value is
 * written: the conversion writes the table's rows one batch at a time, and each update fires the
 * table's triggers, which would run the site's own code once for each value converted.
 */
async function refuseOverUpdateTriggers(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  converted: readonly JudgedFieldTypeChange[]
): Promise<void> {
  const triggersOf = new Map<string, string[]>();
  const errors: { path: string; code: string; message: string }[] = [];
  for (const change of converted) {
    let fired = triggersOf.get(change.table);
    if (fired === undefined) {
      fired = await readUpdateTriggers(db, dialect, change.table);
      triggersOf.set(change.table, fired);
    }
    if (fired.length === 0) continue;
    errors.push({
      path: `fields.${change.to.name}`,
      code: "TYPE_CHANGE_BLOCKED",
      message: `${label}: field '${change.to.name}' cannot change from ${change.from.type} to ${change.to.type}: the change writes each of its values again, and ${change.table} has ${fired.length === 1 ? "a trigger that fires" : "triggers that fire"} on every row it writes (${fired.join(", ")}). Drop or disable ${fired.length === 1 ? "it" : "them"} first, then save again.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: {
      reason: "type-change-over-update-triggers",
      triggers: Object.fromEntries(triggersOf),
    },
  });
}

/**
 * Refuse, on SQLite, a column the conversion swaps for the column beside it (`swapsOnSqlite`)
 * where the swap's `DROP COLUMN` would stop part-way: a view or a trigger whose text names the
 * table, an index on the table over an expression or with a condition, or a UNIQUE constraint on
 * the column, which SQLite keeps whole or refuses to drop a column under. Each is named.
 */
async function refuseSqliteSwapDependents(
  db: unknown,
  label: string,
  swapped: readonly ConvertedColumn[]
): Promise<void> {
  const errors: { path: string; code: string; message: string }[] = [];
  for (const column of swapped) {
    const dependents = await sqliteSwapDependents(
      db,
      column.table,
      column.column
    );
    if (dependents.length === 0) continue;
    errors.push({
      path: `fields.${column.field}`,
      code: "TYPE_CHANGE_BLOCKED",
      message: `${label}: field '${column.field}' cannot change type in ${column.table}, whose column the change replaces with one of the new type, while ${dependents.join(", ")} ${dependents.length === 1 ? "depends" : "depend"} on the table. Drop ${dependents.length === 1 ? "it" : "them"} first, then save again.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "type-change-swap-dependents" },
  });
}

/**
 * What on SQLite depends on `table` beyond the plain indexes a column swap makes again: each view
 * and trigger whose text names it, each of its indexes over an expression or with a condition, and
 * a UNIQUE constraint on `column`, whose index SQLite made itself and drops with no column.
 */
async function sqliteSwapDependents(
  db: unknown,
  table: string,
  column: string
): Promise<string[]> {
  const named = new RegExp(`\\b${escapeRegExp(table)}\\b`, "i");
  const objects = await querySqlRows<{
    type: string;
    name: string;
    sql: string | null;
  }>(
    db,
    "sqlite",
    sql`SELECT type, name, sql FROM sqlite_master WHERE type IN ('view', 'trigger')`
  );
  const dependents = objects
    .filter(object => object.sql !== null && named.test(object.sql))
    .map(object => `${object.type} ${object.name}`);
  const indexes = await querySqlRows<{ name: string; sql: string | null }>(
    db,
    "sqlite",
    sql`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND lower(tbl_name) = ${table.toLowerCase()}`
  );
  for (const index of indexes) {
    if (index.sql === null) {
      // An index SQLite made itself: a UNIQUE or PRIMARY KEY constraint, which no column swap
      // can drop.
      const covered = await querySqlRows<{ name: string | null }>(
        db,
        "sqlite",
        sql`SELECT name FROM pragma_index_info(${index.name})`
      );
      if (covered.some(c => c.name?.toLowerCase() === column.toLowerCase())) {
        dependents.push(`the UNIQUE constraint ${index.name}`);
      }
      continue;
    }
    // An expression's place in an index is column -2 (`pragma_index_xinfo`).
    const expressions = await querySqlRows<{ cid: number }>(
      db,
      "sqlite",
      sql`SELECT cid FROM pragma_index_xinfo(${index.name}) WHERE cid = -2`
    );
    if (expressions.length > 0 || /\bWHERE\b/i.test(index.sql)) {
      dependents.push(`index ${index.name}`);
    }
  }
  return dependents;
}

/** `text` with every character a regular expression gives a meaning escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A column's own definition, read before the conversion changes it. */
interface ColumnFacts {
  /** Its type as the database states it, to restate it (MySQL's `MODIFY`). */
  type: string;
  notNull: boolean;
  /** Its default as a clause (`DEFAULT …`), where it has one: read on PostgreSQL alone. */
  defaultClause?: string;
}

/** `column` of `table` as the database defines it (`ColumnFacts`). */
async function columnFactsOf(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
): Promise<ColumnFacts> {
  if (dialect === "postgresql") {
    const [row] = await querySqlRows<{
      type: string;
      not_null: boolean;
      default_expr: string | null;
    }>(
      db,
      dialect,
      sql`SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
                 pg_get_expr(d.adbin, d.adrelid) AS default_expr
          FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = to_regclass(quote_ident(${table}))
            AND a.attname = ${column} AND NOT a.attisdropped`
    );
    return {
      type: row?.type ?? "text",
      notNull: row?.not_null === true,
      ...(row?.default_expr == null
        ? {}
        : { defaultClause: `DEFAULT ${row.default_expr}` }),
    };
  }
  if (dialect === "mysql") {
    const [row] = await querySqlRows<{
      column_type: string;
      is_nullable: string;
      charset: string | null;
      collation: string | null;
    }>(
      db,
      dialect,
      sql`SELECT COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
                 CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND lower(TABLE_NAME) = ${table.toLowerCase()}
            AND lower(COLUMN_NAME) = ${column.toLowerCase()}`
    );
    // A character column's set and collation are part of its type; JSON's are fixed, and stated
    // again they are refused.
    const charset =
      row?.charset == null || !/char|text|enum|set\(/i.test(row.column_type)
        ? ""
        : ` CHARACTER SET ${row.charset}${row.collation == null ? "" : ` COLLATE ${row.collation}`}`;
    return {
      type: `${row?.column_type ?? "longtext"}${charset}`,
      notNull: row?.is_nullable === "NO",
    };
  }
  const [row] = await querySqlRows<{ type: string; notnull: number }>(
    db,
    dialect,
    sql`SELECT type, "notnull" FROM pragma_table_info(${table}) WHERE lower(name) = ${column.toLowerCase()}`
  );
  return { type: row?.type ?? "", notNull: row?.notnull === 1 };
}

/** The names of `table`'s columns. */
async function columnNamesOf(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<string[]> {
  const rows =
    dialect === "postgresql"
      ? await querySqlRows<{ name: string }>(
          db,
          dialect,
          sql`SELECT attname AS name FROM pg_attribute
              WHERE attrelid = to_regclass(quote_ident(${table})) AND attnum > 0
                AND NOT attisdropped`
        )
      : dialect === "mysql"
        ? await querySqlRows<{ name: string }>(
            db,
            dialect,
            sql`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND lower(TABLE_NAME) = ${table.toLowerCase()}`
          )
        : await querySqlRows<{ name: string }>(
            db,
            dialect,
            sql`SELECT name FROM pragma_table_info(${table})`
          );
  return rows.map(row => row.name);
}

/**
 * One column converted on `dialect`, as the module's header describes for each: the readings
 * written into the column beside it a page at a time, from the values judged again as they are
 * read, then the column given the new type and those values.
 *
 * @throws {NextlyError} where the values judged as they are written clear another count than the
 *   judgement before any statement did: written since, by a writer no hold kept out
 */
async function convertColumn(
  db: unknown,
  dialect: SupportedDialect,
  of: {
    input: EntityTypeChangeInput;
    consent: ClearConsent;
    planned: PlannedColumn;
  }
): Promise<void> {
  const { input, planned } = of;
  const table = sql.identifier(planned.table);
  const run = (statement: SQL) => runStatement(db, dialect, statement);
  const beside = sql.identifier(BESIDE);
  const type = sql.raw(planned.type);
  await run(sql`ALTER TABLE ${table} ADD COLUMN ${beside} ${type} NULL`);
  // The values judged again as they are written, each page of readings written before the next is
  // read; a row cleared, or empty, keeps the column beside it empty: no value.
  const { judged } = await judgeEntityTypeChanges(
    db,
    dialect,
    { ...input, acknowledged: planned.acknowledged },
    {
      only: (t, c) => t === planned.table && c === planned.column,
      readingPages: () => ({
        size: ROWS_PER_STATEMENT,
        write: page =>
          writeReadings(
            run,
            planned.table,
            page,
            dialect === "postgresql" ? type : undefined
          ),
      }),
    }
  );
  const cleared = judged.reduce(
    (sum, change) => sum + change.result.cleared.length,
    0
  );
  // A value written since the judgement before any statement may now block the change, or change
  // how many it clears: either stops it before the column changes type.
  const { refusals } = consentedRefusals(input.label, judged, of.consent);
  if (refusals.length > 0 || cleared !== planned.cleared) {
    // The column untouched, the columns this conversion made go before it stops: on MySQL, whose
    // schema statements commit on their own, they would stay and refuse the run tried again.
    await run(sql`ALTER TABLE ${table} DROP COLUMN ${beside}`);
    throwTypeChangeRefusals(input.label, refusals);
    throw valuesChangedWhileConverting({
      label: input.label,
      field: planned.field,
      table: planned.table,
      column: planned.column,
      now: cleared,
      judged: planned.cleared,
    });
  }
  // The column beside goes once the column has taken its values, unless it took the column's place.
  if (!(await swapIn(db, dialect, planned, cleared > 0))) {
    await run(sql`ALTER TABLE ${table} DROP COLUMN ${beside}`);
  }
}

/**
 * The refusal of a conversion whose values were written to between their judgement and their
 * writing, so the count of values it clears changed (`now`, not `judged`): by a writer no hold
 * kept out. Thrown before the column changes type; the run is tried again once the writes end.
 */
export function valuesChangedWhileConverting(args: {
  label: string;
  field: string;
  table: string;
  column: string;
  now: number;
  judged: number;
}): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: `fields.${args.field}`,
        code: "TYPE_CHANGE_CLEAR_COUNT_CHANGED",
        message: `${args.label}: ${args.field} was written to while its values were converted, and now holds ${String(args.now)} value(s) that cannot convert, not ${String(args.judged)}. Try again once its writes have finished.`,
      },
    ],
    logContext: {
      reason: "type-change-clear-count-changed",
      table: args.table,
      column: args.column,
    },
  });
}

/**
 * The column given its new type and the values written beside it (`BESIDE`), as the module's
 * header describes for each dialect. Before the type changes, on PostgreSQL its default goes (a
 * field's column declares none, and an old one need not cast to the new type) and, where values
 * are cleared, its NOT NULL (the field the change leaves is optional, as a clear into a required
 * one is refused); on MySQL its NOT NULL goes before it is emptied, the file's or push's own
 * statement then stating the column whole.
 */
async function swapIn(
  db: unknown,
  dialect: SupportedDialect,
  planned: PlannedColumn,
  clears: boolean
): Promise<boolean> {
  const table = sql.identifier(planned.table);
  const column = sql.identifier(planned.column);
  const beside = sql.identifier(BESIDE);
  const run = (statement: SQL) => runStatement(db, dialect, statement);
  if (dialect === "sqlite" && planned.swaps) {
    // No rebuild gives this column its new type: the column beside, of that type, takes its place,
    // and the column's indexes (a translated unique field's per-language one) are made again on it.
    await replaceColumn(db, planned.table, BESIDE, planned.column);
    return true;
  }
  if (dialect === "sqlite") {
    // Every row takes what the column beside holds, an empty one no value; the rebuild that gives
    // the column its new type keeps it.
    await run(sql`UPDATE ${table} SET ${column} = ${beside}`);
    return false;
  }
  const type = sql.raw(planned.type);
  if (dialect === "postgresql") {
    if (planned.facts.defaultClause !== undefined) {
      await run(sql`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`);
    }
    if (clears && planned.facts.notNull) {
      await run(sql`ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL`);
    }
    await run(
      sql`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${type} USING ${beside}`
    );
    return false;
  }
  if (planned.facts.notNull) {
    await run(
      sql`ALTER TABLE ${table} MODIFY COLUMN ${column} ${sql.raw(planned.facts.type)} NULL`
    );
  }
  await run(sql`UPDATE ${table} SET ${column} = NULL`);
  await run(sql`ALTER TABLE ${table} MODIFY COLUMN ${column} ${type} NULL`);
  await run(sql`UPDATE ${table} SET ${column} = ${beside}`);
  return false;
}

/**
 * On SQLite, `column` of `table` replaced by `by`, which takes its name: the indexes that cover
 * `column` dropped first and made again on it after, from the statements that made them.
 */
async function replaceColumn(
  db: unknown,
  table: string,
  by: string,
  column: string
): Promise<void> {
  const run = (statement: SQL) => runStatement(db, "sqlite", statement);
  const indexes = await sqliteIndexesOn(db, table, column);
  for (const index of indexes) {
    await run(sql`DROP INDEX ${sql.identifier(index.name)}`);
  }
  await run(
    sql`ALTER TABLE ${sql.identifier(table)} DROP COLUMN ${sql.identifier(column)}`
  );
  await run(
    sql`ALTER TABLE ${sql.identifier(table)} RENAME COLUMN ${sql.identifier(by)} TO ${sql.identifier(column)}`
  );
  for (const index of indexes) await run(sql.raw(index.sql));
}

/**
 * One page of readings written into the column beside the converted one (`BESIDE`), by its rows,
 * in one statement.
 *
 * @param cast the new type, where the database types each written value by it (PostgreSQL)
 */
async function writeReadings(
  run: (statement: SQL) => Promise<void>,
  table: string,
  page: readonly Reading[],
  cast?: SQL
): Promise<void> {
  if (page.length === 0) return;
  const cases = sql.join(
    page.map(row => sql`WHEN ${rowIs(row.key)} THEN ${row.readsAs}`),
    sql` `
  );
  const value = sql`CASE ${cases} END`;
  await run(
    sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(BESIDE)} = ${cast === undefined ? value : sql`CAST(${value} AS ${cast})`} WHERE ${sql.join(
      page.map(row => sql`(${rowIs(row.key)})`),
      sql` OR `
    )}`
  );
}

/** The indexes of a SQLite table that cover `column`, each with the statement that made it. */
async function sqliteIndexesOn(
  db: unknown,
  table: string,
  column: string
): Promise<{ name: string; sql: string }[]> {
  const made = await querySqlRows<{ name: string; sql: string | null }>(
    db,
    "sqlite",
    sql`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ${table}`
  );
  const covering: { name: string; sql: string }[] = [];
  for (const index of made) {
    // An index SQLite makes itself (a key's) has no statement, and is not one a column swap drops.
    if (index.sql === null) continue;
    const columns = await querySqlRows<{ name: string | null }>(
      db,
      "sqlite",
      sql`SELECT name FROM pragma_index_info(${index.name})`
    );
    if (columns.some(c => c.name?.toLowerCase() === column.toLowerCase())) {
      covering.push({ name: index.name, sql: index.sql });
    }
  }
  return covering;
}

/** The condition naming one row: an entry by its id, a translation by its entry and language. */
function rowIs(key: RowKey): SQL {
  return "id" in key
    ? sql`${sql.identifier("id")} = ${key.id}`
    : sql`${sql.identifier("_parent")} = ${key.parent} AND ${sql.identifier("_locale")} = ${key.locale}`;
}
