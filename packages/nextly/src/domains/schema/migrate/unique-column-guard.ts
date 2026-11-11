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
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import {
  introspectLiveColumns,
  introspectLiveSnapshot,
  introspectTableNames,
} from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { readUniqueColumns } from "../pipeline/live-table-facts";
import type { RequiredColumnEntity } from "../required-column-refusal";
import { requiredColumnRegistries } from "../required-column-registries";
import type { ColumnOrigin } from "../services/field-column-descriptor";

import type { MigrationUnit } from "./migration-transaction";
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
  /**
   * Whether the values may be shown: a relationship's are ids of entries. Any other column's may
   * be anything, a secret included, so the refusal and the log give only how many repeat.
   */
  showValues: boolean;
}

/** A collection or Single the registry records, with what is read of it here. */
export interface RegisteredEntity {
  entity: RequiredColumnEntity;
  table: string;
  fields: FieldDefinition[];
  localized: boolean;
  /** Which builder made its table, which decides each translated column's name. */
  builtBy: ColumnOrigin;
}

/** A stored field list, as the registry holds it: JSON text or a parsed list. */
function fieldsOf(raw: unknown): FieldDefinition[] {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(value) ? (value as FieldDefinition[]) : [];
}

/** Each collection and Single the registry records, with its table and fields. */
export async function registeredEntities(
  db: unknown,
  dialect: SupportedDialect
): Promise<RegisteredEntity[]> {
  // Field groups keep their uniqueness by their own Unique mark alone, never a relationship's
  // cardinality, so only collections and Singles are asked.
  const registries = (await requiredColumnRegistries(db, dialect)).filter(
    ([kind]) => kind !== "fieldGroup"
  );
  const present = new Set(
    (
      await introspectTableNames(
        db,
        dialect,
        registries.map(([, table]) => table)
      )
    ).map(name => name.toLowerCase())
  );
  const entities: RegisteredEntity[] = [];
  for (const [kind, registry] of registries) {
    if (!present.has(registry.toLowerCase())) continue;
    const rows = await querySqlRows<{
      slug: string;
      table_name: string;
      fields: unknown;
      localized: unknown;
      source: unknown;
    }>(
      db,
      dialect,
      sql`SELECT ${sql.identifier("slug")} AS slug, ${sql.identifier("table_name")} AS table_name, ${sql.identifier("fields")} AS fields, ${sql.identifier("localized")} AS localized, ${sql.identifier("source")} AS source FROM ${sql.identifier(registry)}`
    );
    for (const row of rows) {
      entities.push({
        entity: { kind, slug: String(row.slug) },
        table: String(row.table_name),
        fields: fieldsOf(row.fields),
        // A boolean on PostgreSQL, a number on MySQL and SQLite.
        localized: row.localized === true || Number(row.localized) === 1,
        // A code-first entity's table is the code-first builder's; any other, the Schema Builder's.
        builtBy: row.source === "code" ? "codeFirst" : "collection",
      });
    }
  }
  return entities;
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
  const count = column.repeats.length;
  const thing = column.entity.kind === "table" ? "column" : "field";
  const subject = `${LABELS[column.entity.kind]} '${column.entity.slug}': ${thing} '${column.field}' cannot become unique while ${count} ${count === 1 ? "value repeats" : "values repeat"}`;
  const advice =
    "Give each entry its own value, or clear the repeats, then run `nextly migrate` again.";
  if (!column.showValues) {
    const most = Math.max(...column.repeats.map(r => r.entries));
    return `${subject}, the most repeated one in ${most} entries. ${advice}`;
  }
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
  return `${subject}: ${listed}${rest}. ${advice}`;
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
        // A value that may be a secret never reaches the log either: only how many hold it.
        repeats: c.showValues
          ? c.repeats
          : c.repeats.map(({ entries, language }) => ({
              entries,
              ...(language === undefined ? {} : { language }),
            })),
      })),
    },
  });
}

/** A single-column unique index a statement of a file creates, and where in the file. */
interface UniqueTarget {
  table: string;
  column: string;
  /** The statement's position in the file. */
  at: number;
}

/** The single-column unique indexes `statements` create, each with its position. */
function uniqueTargets(
  statements: readonly string[],
  dialect: SupportedDialect
): UniqueTarget[] {
  return statements.flatMap((statement, at) =>
    (uniqueIndexesCreatedBy(statement, dialect) ?? [])
      .filter(index => index.columns.length === 1)
      .map(index => ({ table: index.table, column: index.columns[0], at }))
  );
}

/**
 * Whether a statement before `at` writes rows of `table` (INSERT, UPDATE, DELETE, MySQL's
 * REPLACE): the values a unique index made at `at` must hold are then the ones those leave.
 */
function writtenBefore(
  statements: readonly string[],
  dialect: SupportedDialect,
  table: string,
  at: number
): boolean {
  return statements
    .slice(0, at)
    .some(
      statement =>
        /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(statement) &&
        tablesChangedIn(statement, dialect)?.includes(table) === true
    );
}

/**
 * One unique index's column judged as the database stands: undefined where the table or column
 * is not there, a unique index already holds it, or nothing repeats. A table the registry names
 * is named by its entity and field, any other (a plugin's, an extension's) by its table and
 * column, and only a relationship's values are shown.
 */
async function judgeUniqueTarget(
  db: unknown,
  dialect: SupportedDialect,
  target: UniqueTarget
): Promise<UniqueColumnRepeats | undefined> {
  const owner = (await readRequiredColumnOwners(db, dialect)).owner(
    target.table
  );
  const live = await introspectLiveColumns(db, dialect, [
    owner?.table ?? target.table,
  ]);
  const table = live.tables[0];
  const spelled = table?.columns.find(
    c => c.name.toLowerCase() === target.column
  );
  if (table === undefined || spelled === undefined) return undefined;
  const unique = await readUniqueColumns(db, dialect, table.name);
  if ([...unique.keys()].some(name => name.toLowerCase() === target.column)) {
    return undefined;
  }
  const repeats = await readRepeatedValues(
    db,
    dialect,
    table.name,
    spelled.name
  );
  if (repeats.length === 0) return undefined;
  const field = owner?.fieldsByColumn.get(target.column);
  const definition =
    field === undefined
      ? undefined
      : (await registeredEntities(db, dialect))
          .find(e => e.table.toLowerCase() === table.name.toLowerCase())
          ?.fields.find(f => f.name === field);
  return {
    entity: owner?.entity ?? { kind: "table", slug: table.name },
    field: field ?? target.column,
    table: table.name,
    column: target.column,
    repeats,
    showValues: definition?.type === "relationship",
  };
}

/**
 * Refuse, before any of its statements runs, a migration file that makes a column unique while
 * the column's entries repeat a value. Each single-column unique index the file creates
 * (`uniqueIndexesCreatedBy`) is judged over a column the table already has and no unique index
 * holds, except one whose table an earlier statement of the file writes: that one is judged at
 * its statement (`uniqueIndexCheckpoint`), over the values those writes leave.
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
  const refused: UniqueColumnRepeats[] = [];
  for (const target of uniqueTargets(statements, dialect)) {
    if (writtenBefore(statements, dialect, target.table, target.at)) continue;
    const found = await judgeUniqueTarget(db, dialect, target);
    if (found !== undefined) refused.push(found);
  }
  if (refused.length > 0) throw uniqueColumnRepeatsError(refused, source);
}

/**
 * The check a unit's runner makes before each statement, for each unique index whose table an
 * earlier statement of the unit writes, through the handle the statements run on (the
 * transaction's, when there is one): the values those writes leave. Undefined when the unit has
 * no such index, so a runner pays nothing for it. Outside a transaction the statements before it
 * have run and stay applied, and the refusal says so.
 */
export function uniqueIndexCheckpoint(
  statements: readonly string[],
  dialect: SupportedDialect,
  unit: MigrationUnit
): ((db: unknown, index: number) => Promise<void>) | undefined {
  const atStatement = uniqueTargets(statements, dialect).filter(target =>
    writtenBefore(statements, dialect, target.table, target.at)
  );
  if (atStatement.length === 0) return undefined;
  return async (db, index) => {
    const refused: UniqueColumnRepeats[] = [];
    for (const target of atStatement.filter(t => t.at === index)) {
      const found = await judgeUniqueTarget(db, dialect, target);
      if (found !== undefined) refused.push(found);
    }
    if (refused.length === 0) return;
    const ran = unit.transaction
      ? ""
      : ` Its first ${index} statement(s) ran before this one and stayed applied.`;
    throw uniqueColumnRepeatsError(
      refused,
      `${unit.source} at statement ${index + 1}${ran}`
    );
  };
}

/** A unique index a file creates that the live table already carries. */
export interface AdoptedUniqueIndex {
  table: string;
  name: string;
}

/**
 * Whether a statement drops `table`, or may drop an index of it: a DROP TABLE naming it, a DROP
 * INDEX naming `index`, MySQL's DROP INDEX on the table, whose index is not read here, or an
 * ALTER TABLE on it that drops or renames anything (a column, a constraint, an index), which may
 * take the index with it.
 */
function dropsTableOrIndex(
  statement: string,
  dialect: SupportedDialect,
  table: string,
  index: string
): boolean {
  if (tablesDroppedBy(statement, dialect)?.includes(table)) return true;
  if (indexesDroppedBy(statement, dialect)?.includes(index)) return true;
  const onTable = tablesChangedIn(statement, dialect)?.includes(table) === true;
  if (/^\s*DROP\s+INDEX\b/i.test(statement)) return onTable;
  return (
    onTable &&
    /^\s*ALTER\s+TABLE\b/i.test(statement) &&
    /\b(DROP|RENAME|CHANGE|MODIFY)\b/i.test(statement)
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
