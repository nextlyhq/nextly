/**
 * `nextly migrate` refusing to make a column unique while its entries already repeat a value,
 * naming the entity, the field and the values.
 *
 * A unique index over repeats is refused by the database part-way through: on MySQL every
 * statement before it stays applied. So the repeats are read first, by the one reader here
 * (`readRepeatedValues`), and refused with the one refusal here (`uniqueColumnRepeatsError`),
 * for a migration file that creates a unique index (`refuseUniqueIndexesOverRepeats`, before any
 * of its statements) and for the run's own step that makes one-to-ones unique.
 *
 * A table the registry names as a collection's, a Single's or a field group's
 * (`readRequiredColumnOwners`) is named by its entity and field; any other (a plugin's, an
 * extension's) by its table and column. A column is judged only where it is on the table already and no unique
 * index holds it yet: a column the file adds holds no value to repeat, and one already unique
 * cannot.
 *
 * A file creating a unique index the live table already carries, under that name and on that
 * column, has it left out (`adoptUniqueIndexesAlreadyThere`): the run's own step, or a Builder
 * save, may have made it before the file was written. PostgreSQL and SQLite would adopt it
 * through `IF NOT EXISTS`; MySQL has no such spelling and would fail on the duplicate name, and
 * every dialect's drift check would read the index as a change nobody recorded.
 *
 * @module domains/schema/migrate/unique-column-guard
 */
import { sql } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import {
  introspectLiveColumns,
  introspectLiveSnapshot,
} from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { readUniqueColumns } from "../pipeline/live-table-facts";
import type { RequiredColumnEntity } from "../required-column-refusal";

import { readRequiredColumnOwners } from "./required-column-guard";
import {
  indexesDroppedBy,
  tablesChangedIn,
  tablesDroppedBy,
  uniqueIndexesCreatedBy,
} from "./statement-targets";

/** The values a refusal lists for each column; the rest are counted, and all of them logged. */
export const LISTED_REPEATS = 20;

/** One value a column holds in more than one entry, and in how many: in one language, for a translated one. */
export interface RepeatedValue {
  value: string;
  entries: number;
  language?: string;
}

/** A column that cannot become unique: whose it is, and the values its entries repeat. */
export interface UniqueColumnRepeats {
  entity: RequiredColumnEntity;
  field: string;
  table: string;
  column: string;
  /** Every repeated value, most repeated first. */
  repeats: RepeatedValue[];
}

/**
 * Every value `column` of `table` holds in more than one entry, most repeated first. An entry
 * holding no value repeats nothing: a unique index leaves NULL free on every dialect.
 *
 * @param language a translations table's language column: a value repeats only within one
 *   language there, as its unique index is per language
 * @param blankRepeatsNothing a translated text column's: its index leaves a blank (`''`) out, as an
 *   untranslated value, so blanks never repeat
 */
export async function readRepeatedValues(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string,
  language?: string,
  blankRepeatsNothing = false
): Promise<RepeatedValue[]> {
  const value = sql.identifier(column);
  const present = blankRepeatsNothing
    ? sql`${value} IS NOT NULL AND ${value} <> ''`
    : sql`${value} IS NOT NULL`;
  const grouped =
    language === undefined
      ? sql`${value}`
      : sql`${value}, ${sql.identifier(language)}`;
  const languageOut =
    language === undefined
      ? sql``
      : sql`, ${sql.identifier(language)} AS ${sql.identifier("language")}`;
  const rows = await querySqlRows<{
    value: unknown;
    entries: unknown;
    language?: unknown;
  }>(
    db,
    dialect,
    sql`SELECT ${value} AS ${sql.identifier("value")}${languageOut}, COUNT(*) AS ${sql.identifier("entries")} FROM ${sql.identifier(table)} WHERE ${present} GROUP BY ${grouped} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, ${grouped}`
  );
  return rows.map(row => ({
    value: String(row.value),
    entries: Number(row.entries),
    ...(language === undefined ? {} : { language: String(row.language) }),
  }));
}

const LABELS: Record<RequiredColumnEntity["kind"], string> = {
  collection: "Collection",
  single: "Single",
  fieldGroup: "Field group",
  table: "Table",
};

/** One column's line in a refusal: its first values, and how many more there are. */
function repeatsMessage(column: UniqueColumnRepeats): string {
  const listed = column.repeats
    .slice(0, LISTED_REPEATS)
    .map(
      r =>
        `"${r.value}" (${r.entries} entries${r.language === undefined ? "" : ` in "${r.language}"`})`
    )
    .join(", ");
  const more = column.repeats.length - LISTED_REPEATS;
  const rest =
    more > 0 ? `, and ${more} more (the full list is in the log)` : "";
  const count = column.repeats.length;
  const thing = column.entity.kind === "table" ? "column" : "field";
  return `${LABELS[column.entity.kind]} '${column.entity.slug}': ${thing} '${column.field}' cannot become unique while ${count} ${count === 1 ? "value repeats" : "values repeat"}: ${listed}${rest}. Give each entry its own value, or clear the repeats, then run \`nextly migrate\` again.`;
}

/**
 * The refusal: each column with its first `LISTED_REPEATS` values, and every value in the log.
 *
 * @param source what was refused: the migration file, or the run's own step
 */
export function uniqueColumnRepeatsError(
  columns: readonly UniqueColumnRepeats[],
  source: string
): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: `${source} was not applied. ${columns.map(repeatsMessage).join(" ")}`,
    logContext: {
      reason: "unique-column-over-repeats",
      source,
      columns: columns.map(c => ({
        entity: `${c.entity.kind}:${c.entity.slug}`,
        field: c.field,
        table: c.table,
        column: c.column,
        repeats: c.repeats,
      })),
    },
  });
}

/**
 * Refuse, before any of its statements runs, a migration file that makes a column unique while
 * the column's entries repeat a value. Each single-column unique index the file creates
 * (`uniqueIndexesCreatedBy`) is judged on a table the registry names, over a column the table
 * already has and no unique index holds.
 *
 * @param statements the file's statements, as the runner splits them
 * @param source the file's name, which the refusal names
 */
export async function refuseUniqueIndexesOverRepeats(
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[],
  source: string
): Promise<void> {
  const created = statements.flatMap(
    statement => uniqueIndexesCreatedBy(statement, dialect) ?? []
  );
  const targets = created.filter(index => index.columns.length === 1);
  if (targets.length === 0) return;
  const owners = await readRequiredColumnOwners(db, dialect);
  const refused: UniqueColumnRepeats[] = [];
  for (const target of targets) {
    const owner = owners.owner(target.table);
    const column = target.columns[0];
    // A table that is not a collection's, a Single's or a field group's (a plugin's, an
    // extension's) is judged too, and named by its table and column.
    const table = owner?.table ?? target.table;
    const live = await introspectLiveColumns(db, dialect, [table]);
    const spelled = live.tables[0]?.columns.find(
      c => c.name.toLowerCase() === column
    );
    if (live.tables[0] === undefined || spelled === undefined) continue;
    const unique = await readUniqueColumns(db, dialect, live.tables[0].name);
    if ([...unique.keys()].some(name => name.toLowerCase() === column)) {
      continue;
    }
    const repeats = await readRepeatedValues(
      db,
      dialect,
      live.tables[0].name,
      spelled.name
    );
    if (repeats.length > 0) {
      refused.push({
        entity: owner?.entity ?? { kind: "table", slug: live.tables[0].name },
        field: owner?.fieldsByColumn.get(column) ?? column,
        table: live.tables[0].name,
        column,
        repeats,
      });
    }
  }
  if (refused.length > 0) throw uniqueColumnRepeatsError(refused, source);
}

/** A unique index a file creates that the live table already carries. */
export interface AdoptedUniqueIndex {
  table: string;
  name: string;
}

/**
 * Whether a statement drops `table`, or may drop an index of it: a DROP TABLE naming it, a DROP
 * INDEX naming `index`, or MySQL's DROP INDEX on the table, whose index is not read here.
 */
function dropsTableOrIndex(
  statement: string,
  dialect: SupportedDialect,
  table: string,
  index: string
): boolean {
  if (tablesDroppedBy(statement, dialect)?.includes(table)) return true;
  if (indexesDroppedBy(statement, dialect)?.includes(index)) return true;
  return (
    /^\s*DROP\s+INDEX\b/i.test(statement) &&
    tablesChangedIn(statement, dialect)?.includes(table) === true
  );
}

/**
 * The file's statements less each create of a single-column unique index the live table already
 * carries under that name, unique and on that one column, with the indexes left out. Only an index
 * the file creates as new is adopted: not one it re-creates after an earlier statement of its own
 * drops the table or the index (a SQLite rebuild re-creates every index of the table it rebuilds),
 * and not one the file's snapshot before it records. A table the database does not have yet
 * carries nothing to adopt.
 *
 * @param recordedBefore the schema the file's own snapshot says it starts from, where it has one
 */
export async function adoptUniqueIndexesAlreadyThere(
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[],
  recordedBefore?: NextlySchemaSnapshot
): Promise<{ statements: string[]; adopted: AdoptedUniqueIndex[] }> {
  const kept: string[] = [];
  const adopted: AdoptedUniqueIndex[] = [];
  for (const [at, statement] of statements.entries()) {
    const [created] = uniqueIndexesCreatedBy(statement, dialect) ?? [];
    if (created === undefined || created.columns.length !== 1) {
      kept.push(statement);
      continue;
    }
    const recreated = statements
      .slice(0, at)
      .some(earlier =>
        dropsTableOrIndex(earlier, dialect, created.table, created.name)
      );
    const recorded = recordedBefore?.tables
      .find(table => table.name.toLowerCase() === created.table)
      ?.indexes?.some(index => index.name.toLowerCase() === created.name);
    if (recreated || recorded === true) {
      kept.push(statement);
      continue;
    }
    const live = await introspectLiveSnapshot(db, dialect, [created.table]);
    // Only an index holding the whole column, as the file's does: one with a predicate or over an
    // expression leaves values outside it free to repeat.
    const there = live.tables[0]?.indexes?.some(
      index =>
        index.unique &&
        index.where === undefined &&
        index.expression === undefined &&
        index.name.toLowerCase() === created.name &&
        index.columns.length === 1 &&
        index.columns[0].toLowerCase() === created.columns[0]
    );
    if (there === true) {
      adopted.push({ table: created.table, name: created.name });
    } else {
      kept.push(statement);
    }
  }
  return { statements: kept, adopted };
}

/**
 * `live` without the indexes a file adopted: the state the file's own snapshot before it
 * records, which the drift check compares against.
 */
export function withoutAdoptedIndexes(
  live: NextlySchemaSnapshot,
  adopted: readonly AdoptedUniqueIndex[]
): NextlySchemaSnapshot {
  if (adopted.length === 0) return live;
  const isAdopted = (table: string, index: string) =>
    adopted.some(
      a => a.table === table.toLowerCase() && a.name === index.toLowerCase()
    );
  return {
    ...live,
    tables: live.tables.map(table =>
      table.indexes === undefined
        ? table
        : {
            ...table,
            indexes: table.indexes.filter(
              index => !isAdopted(table.name, index.name)
            ),
          }
    ),
  };
}
