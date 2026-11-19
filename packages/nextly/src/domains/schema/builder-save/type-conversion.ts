/**
 * A save's field type changes carried out value by value: each kept or changed value written as
 * the new type reads it, and each value the person confirmed clearing written as no value, so no
 * value reaches the new type through the database's cast. Built from the judgement the save makes
 * before anything runs (`judgeFieldTypeChanges` with `rewrites`), for the pairs it converts
 * (`rewritesPair`); every other change is left to the cast, judged as before.
 *
 * It runs where the save's own type change would, just before it: in the transaction of the
 * migration file that changes the column, before its first statement (`runUnitInTries`' `before`),
 * or just before the push that applies the change. Once it has run the column already has its new
 * type and its values, so the file's or the push's own statement finds nothing left to change:
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

import { fieldToLocalizedColumnSpec } from "../../i18n/migration/field-to-column-spec";
import { runStatement } from "../pipeline/_internal/run-statement";
import type { ColumnOrigin } from "../services/field-column-descriptor";
import { columnDescriptorAt } from "../value-conversion/type-change/field-type";
import type { JudgedFieldTypeChange } from "../value-conversion/type-change/field-type-changes";
import type { RowKey } from "../value-conversion/types";

/** How many rows one statement writes, so a large table is written in a few statements. */
const ROWS_PER_STATEMENT = 200;

/** The column a conversion writes beside the one it converts, on PostgreSQL and MySQL. */
const BESIDE = "__nextly_converted";

/** One column converted value by value. */
interface ColumnConversion {
  table: string;
  column: string;
  /** The column's new type, as the database spells it. */
  type: string;
  /** Each value to write, as the new type reads it, by its row. */
  readings: readonly { key: RowKey; readsAs: string }[];
  /** The rows whose value is cleared, by the person's consent: written as no value. */
  cleared: readonly RowKey[];
}

/** A save's field type changes, converted value by value. */
export interface TypeConversion {
  /** The tables whose columns it converts. */
  readonly tables: readonly string[];
  /** Converts every column, through `db`, the handle the save's statements run on. */
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
 * The conversion of the judged changes the save rewrites (those judged with `readings`), or
 * undefined where it rewrites none, and the save's type changes are then the database's cast.
 *
 * @param at where the fields' values are kept: their table's creator, and a field group's row
 * @param translationsTable the entity's translations table, whose columns are typed as a
 *   translated field's (`fieldToLocalizedColumnSpec`)
 */
export function typeConversionOf(args: {
  dialect: SupportedDialect;
  judged: readonly JudgedFieldTypeChange[];
  builtBy: ColumnOrigin;
  componentRow?: boolean;
  translationsTable?: string;
}): TypeConversion | undefined {
  const { dialect } = args;
  const columns: ColumnConversion[] = args.judged.flatMap(change => {
    if (change.readings === undefined) return [];
    const type =
      change.table === args.translationsTable
        ? fieldToLocalizedColumnSpec(change.to, dialect, args.builtBy)?.type
        : columnDescriptorAt(change.to, dialect, {
            builtBy: args.builtBy,
            ...(args.componentRow === true ? { componentRow: true } : {}),
          })?.dialectType;
    if (type === undefined) return [];
    return [
      {
        table: change.table,
        column: change.column,
        type,
        readings: change.readings,
        cleared: change.result.cleared,
      },
    ];
  });
  if (columns.length === 0) return undefined;
  const runAll = (only: readonly ColumnConversion[]) => async (db: unknown) => {
    for (const column of only) await convertColumn(db, dialect, column);
  };
  return {
    tables: [...new Set(columns.map(c => c.table))],
    run: runAll(columns),
    runIn: changed => {
      const mine = columns.filter(c => changed.includes(c.table));
      return mine.length === 0 ? undefined : runAll(mine);
    },
  };
}

/** One column converted on `dialect`, as the module's header describes for each. */
async function convertColumn(
  db: unknown,
  dialect: SupportedDialect,
  conversion: ColumnConversion
): Promise<void> {
  const table = sql.identifier(conversion.table);
  const column = sql.identifier(conversion.column);
  const run = (statement: SQL) => runStatement(db, dialect, statement);
  const beside = sql.identifier(BESIDE);
  const type = sql.raw(conversion.type);
  await run(sql`ALTER TABLE ${table} ADD COLUMN ${beside} ${type} NULL`);
  await writeValues(
    run,
    conversion,
    beside,
    dialect === "postgresql" ? type : undefined
  );
  if (dialect === "sqlite") {
    // Every row takes what the column beside holds, an empty one no value; the rebuild that gives
    // the column its new type keeps it.
    await run(sql`UPDATE ${table} SET ${column} = ${beside}`);
  } else if (dialect === "postgresql") {
    await run(
      sql`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${type} USING ${beside}`
    );
  } else {
    await run(sql`UPDATE ${table} SET ${column} = NULL`);
    await run(sql`ALTER TABLE ${table} MODIFY COLUMN ${column} ${type} NULL`);
    await run(sql`UPDATE ${table} SET ${column} = ${beside}`);
  }
  await run(sql`ALTER TABLE ${table} DROP COLUMN ${beside}`);
}

/**
 * Each reading written into `target`, the column made beside the converted one, by its row, and
 * each cleared row's value as no value, a few hundred rows a statement. A row neither read nor
 * cleared (an empty value) keeps the column's empty, no value.
 *
 * @param cast the new type, where the database types each written value by it (PostgreSQL)
 */
async function writeValues(
  run: (statement: SQL) => Promise<void>,
  conversion: ColumnConversion,
  target: SQL,
  cast?: SQL
): Promise<void> {
  const table = sql.identifier(conversion.table);
  for (let at = 0; at < conversion.readings.length; at += ROWS_PER_STATEMENT) {
    const rows = conversion.readings.slice(at, at + ROWS_PER_STATEMENT);
    const cases = sql.join(
      rows.map(row => sql`WHEN ${rowIs(row.key)} THEN ${row.readsAs}`),
      sql` `
    );
    const value = sql`CASE ${cases} END`;
    await run(
      sql`UPDATE ${table} SET ${target} = ${cast === undefined ? value : sql`CAST(${value} AS ${cast})`} WHERE ${sql.join(
        rows.map(row => sql`(${rowIs(row.key)})`),
        sql` OR `
      )}`
    );
  }
  for (let at = 0; at < conversion.cleared.length; at += ROWS_PER_STATEMENT) {
    const rows = conversion.cleared.slice(at, at + ROWS_PER_STATEMENT);
    await run(
      sql`UPDATE ${table} SET ${target} = NULL WHERE ${sql.join(
        rows.map(key => sql`(${rowIs(key)})`),
        sql` OR `
      )}`
    );
  }
}

/** The condition naming one row: an entry by its id, a translation by its entry and language. */
function rowIs(key: RowKey): SQL {
  return "id" in key
    ? sql`${sql.identifier("id")} = ${key.id}`
    : sql`${sql.identifier("_parent")} = ${key.parent} AND ${sql.identifier("_locale")} = ${key.locale}`;
}
