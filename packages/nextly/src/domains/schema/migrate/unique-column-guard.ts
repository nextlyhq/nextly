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
  introspectUnusableIndexes,
} from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { readUniqueColumns } from "../pipeline/live-table-facts";
import type { RequiredColumnEntity } from "../required-column-refusal";
import { requiredColumnRegistries } from "../required-column-registries";
import type { ColumnOrigin } from "../services/field-column-descriptor";

import type { MigrationUnit } from "./migration-transaction";
import { rowWriteOf } from "./not-null-statements";
import { readRequiredColumnOwners } from "./required-column-guard";
import {
  indexesDroppedBy,
  indexesRenamedBy,
  tablesChangedIn,
  renamesIn,
  tablesCreatedBy,
  tablesDroppedBy,
  uniqueIndexesCreatedBy,
  uniqueIndexesReadIn,
  columnsAddedBy,
  type ColumnAdded,
  type StatementRename,
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

/** What each column's line in the repeats refusal tells the reader to do. */
export const UNIQUE_REPEATS_ADVICE =
  "Give each entry its own value, or clear the repeats, then run `nextly migrate` again.";

/** One column's line in a refusal: its first values, and how many more there are. */
function repeatsMessage(column: UniqueColumnRepeats): string {
  const count = column.repeats.length;
  const thing = column.entity.kind === "table" ? "column" : "field";
  const subject = `${LABELS[column.entity.kind]} '${column.entity.slug}': ${thing} '${column.field}' cannot become unique while ${count} ${count === 1 ? "value repeats" : "values repeat"}`;
  const advice = UNIQUE_REPEATS_ADVICE;
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
  /**
   * Whether its statement is read whole (`uniqueIndexesReadIn`): one that is not is judged only
   * at its statement, never before the file runs.
   */
  exact: boolean;
  /** A qualified table's schema: judged only when it is the connection's own (`ownSchema`). */
  qualifier?: string;
}

/** The single-column unique indexes `statements` create, each with its position. */
function uniqueTargets(
  statements: readonly string[],
  dialect: SupportedDialect
): UniqueTarget[] {
  return statements.flatMap((statement, at) =>
    (uniqueIndexesReadIn(statement, dialect) ?? [])
      .filter(index => index.columns.length === 1)
      .map(index => ({
        table: index.table,
        column: index.columns[0],
        at,
        exact: index.exact,
        ...(index.qualifier === undefined
          ? {}
          : { qualifier: index.qualifier }),
      }))
  );
}

/**
 * Whether a statement before `at` may write rows of `table`, as the runner's row-write reading
 * classifies statements (`rowWriteOf`): the values a unique index made at `at` must hold are then
 * the ones those leave. A writer whose reach is not read (`WITH`, `DO`, `CALL`, …), and a named
 * writer whose table is not read here (an alias, several tables, `MERGE`, `TRUNCATE`, `COPY`),
 * counts as writing it: an unknown target is no proof the values were left alone.
 */
function writtenBefore(
  statements: readonly string[],
  dialect: SupportedDialect,
  table: string,
  at: number
): boolean {
  return statements.slice(0, at).some(statement => {
    const writes = rowWriteOf(statement, dialect);
    if (writes === "unread") return true;
    return (
      writes === "named" &&
      (tablesChangedIn(statement, dialect)?.includes(table) ?? true)
    );
  });
}

/**
 * Where the values a target's index must hold are before the file runs (`liveOrigin`): a column
 * the table already has, under the names the file's renames start from; a column the file adds
 * with a constant default, which every row the table holds then takes; or values only its own
 * statement can judge.
 */
type TargetOrigin =
  | { kind: "live"; table: string; column: string }
  | { kind: "filled"; table: string; value: string }
  | { kind: "atStatement" };

const AT_STATEMENT: TargetOrigin = { kind: "atStatement" };

/**
 * Where a target's values are before the file runs, read back through the file's earlier
 * statements: its table and column through their renames (`renamesIn`), and a column the file adds
 * with a constant default (`columnsAddedBy`). Judged only at its statement where an earlier
 * statement makes its table, adds its column any other way, renames in a way not read with
 * certainty (a name renamed twice, a swap or a cycle, a rename beside another clause), or may add
 * a column without being read.
 */
function liveOrigin(
  statements: readonly string[],
  dialect: SupportedDialect,
  target: UniqueTarget
): TargetOrigin {
  const walk: OriginWalk = {
    place: { table: target.table, column: target.column },
    renamed: new Set(),
  };
  for (let at = target.at - 1; at >= 0; at -= 1) {
    if (!stepBack(statements[at], dialect, walk)) return AT_STATEMENT;
  }
  return walk.filledWith === undefined
    ? { kind: "live", ...walk.place }
    : { kind: "filled", table: walk.place.table, value: walk.filledWith };
}

/** `liveOrigin`'s reading so far, from the target back to the statement it has reached. */
interface OriginWalk {
  /** The target's table and column under the names the statements read so far start from. */
  place: { table: string; column: string };
  /** The constant a statement read so far adds the target's column with. */
  filledWith?: string;
  /** The names the renames read so far touched (`renamedOnce`). */
  renamed: Set<string>;
}

/**
 * Reads one earlier statement into `walk`, back to the names before it: false where what it does
 * to the target is not read with certainty, which leaves the target to its own statement.
 */
function stepBack(
  statement: string,
  dialect: SupportedDialect,
  walk: OriginWalk
): boolean {
  if (tablesCreatedBy(statement, dialect)?.includes(walk.place.table)) {
    return false;
  }
  if (
    walk.filledWith === undefined &&
    !noteAddedColumn(statement, dialect, walk)
  ) {
    return false;
  }
  const renames = renamesIn(statement, dialect);
  if (renames === undefined) {
    return !mayRenameUnread(statement, dialect, walk.place.table);
  }
  if (!renamedOnce(walk.renamed, renames)) return false;
  walk.place = beforeRenames(renames, walk.place);
  return true;
}

/**
 * Notes in `walk` the constant `statement` adds the target's column with: false where it adds the
 * column any other way, or may add it without being read.
 */
function noteAddedColumn(
  statement: string,
  dialect: SupportedDialect,
  walk: OriginWalk
): boolean {
  const added = columnAddedBy(statement, dialect, walk.place);
  if (added === undefined) return true;
  if (added === "unread" || added.filledWith === undefined) return false;
  walk.filledWith = added.filledWith;
  return true;
}

/**
 * The column `place` names as `statement` adds it, undefined where it adds no such column, or
 * `unread` where it alters the table in a way not read and may add it.
 */
function columnAddedBy(
  statement: string,
  dialect: SupportedDialect,
  place: { table: string; column: string }
): ColumnAdded | "unread" | undefined {
  const added = columnsAddedBy(statement, dialect);
  if (added === undefined) {
    return (tablesChangedIn(statement, dialect)?.includes(place.table) ?? true)
      ? "unread"
      : undefined;
  }
  return added.find(
    column => column.table === place.table && column.column === place.column
  );
}

/**
 * Notes one statement's renames in `renamed`, the names the file's renames before a target have
 * touched, and whether none of them was touched already: a name renamed twice (a chain, a swap
 * done in one statement, a cycle) is not undone here with certainty.
 */
function renamedOnce(
  renamed: Set<string>,
  renames: readonly StatementRename[]
): boolean {
  for (const rename of renames) {
    const names =
      rename.kind === "table"
        ? [`table ${rename.from}`, `table ${rename.to}`]
        : [
            `column ${rename.table}.${rename.from}`,
            `column ${rename.table}.${rename.to}`,
          ];
    if (names.some(name => renamed.has(name))) return false;
    for (const name of names) renamed.add(name);
  }
  return true;
}

/**
 * A table and column as they were before one statement's renames, undone in reverse, so a column
 * renamed on a table the same statement renames is matched under the name the statement found the
 * table by.
 */
function beforeRenames(
  renames: readonly StatementRename[],
  place: { table: string; column: string }
): { table: string; column: string } {
  let { table, column } = place;
  for (const rename of [...renames].reverse()) {
    if (rename.kind === "table" && rename.to === table) table = rename.from;
    const columnRenamed =
      rename.kind === "column" &&
      rename.table === table &&
      rename.to === column;
    if (columnRenamed) column = rename.from;
  }
  return { table, column };
}

/** Whether a statement not read as renames alone may still rename `table`. */
function mayRenameUnread(
  statement: string,
  dialect: SupportedDialect,
  table: string
): boolean {
  return (
    /\bRENAME\b/i.test(statement) &&
    (tablesChangedIn(statement, dialect)?.includes(table) ?? true)
  );
}

/**
 * The schema an unqualified name reaches on this connection, lower-cased: PostgreSQL's
 * `current_schema()`, MySQL's `DATABASE()`, SQLite's `main`.
 */
async function ownSchema(
  db: unknown,
  dialect: SupportedDialect
): Promise<string> {
  if (dialect === "sqlite") return "main";
  const [row] = await querySqlRows<{ schema: unknown }>(
    db,
    dialect,
    dialect === "postgresql"
      ? sql`SELECT current_schema() AS ${sql.identifier("schema")}`
      : sql`SELECT DATABASE() AS ${sql.identifier("schema")}`
  );
  // A name comes back as text on every driver; anything else names no schema.
  return typeof row?.schema === "string" ? row.schema.toLowerCase() : "";
}

/**
 * Whether an index's table is one an unqualified read reaches: unqualified, or qualified by the
 * connection's own schema. Another schema's rows are not the ones read here.
 */
async function reachedUnqualified(
  db: unknown,
  dialect: SupportedDialect,
  qualifier: string | undefined
): Promise<boolean> {
  return (
    qualifier === undefined || qualifier === (await ownSchema(db, dialect))
  );
}

/**
 * The live table `table` names, through the registry's owner of it where it has one (whose
 * spelling the database keeps), with how a refusal names its column: by the owner's entity and
 * field, or by the table and column.
 */
async function ownedLiveTable(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
) {
  const owner = (await readRequiredColumnOwners(db, dialect)).owner(table);
  const live = await introspectLiveColumns(db, dialect, [
    owner?.table ?? table,
  ]);
  const ownField = owner?.fieldsByColumn.get(column);
  return {
    table: live.tables[0],
    entity: owner?.entity,
    ownField,
  };
}

/** Whether the registry describes `field` of the entity whose table is `table` as a relationship. */
async function isRelationship(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  field: string | undefined
): Promise<boolean> {
  if (field === undefined) return false;
  const definition = (await registeredEntities(db, dialect))
    .find(e => e.table.toLowerCase() === table.toLowerCase())
    ?.fields.find(f => f.name === field);
  return definition?.type === "relationship";
}

/**
 * One unique index's column judged as the database stands: undefined where the table or column
 * is not there, a unique index already holds it, or nothing repeats. A table qualified by another
 * schema than the connection's own is not judged here: its rows are not the ones an unqualified
 * read reaches, so the database alone judges it. A table the registry names is named by its
 * entity and field, any other (a plugin's, an extension's) by its table and column, and only a
 * relationship's values are shown.
 */
async function judgeUniqueTarget(
  db: unknown,
  dialect: SupportedDialect,
  target: Pick<UniqueTarget, "table" | "column" | "qualifier">
): Promise<UniqueColumnRepeats | undefined> {
  if (!(await reachedUnqualified(db, dialect, target.qualifier))) {
    return undefined;
  }
  const { table, entity, ownField } = await ownedLiveTable(
    db,
    dialect,
    target.table,
    target.column
  );
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
  return {
    entity: entity ?? { kind: "table", slug: table.name },
    field: ownField ?? target.column,
    table: table.name,
    column: target.column,
    repeats,
    showValues: await isRelationship(db, dialect, table.name, ownField),
  };
}

/**
 * A column the file adds with a constant default, judged before the file runs: every row its
 * table holds takes that one value, so two rows or more repeat it. Only how many is told: the
 * column is not one the registry describes yet.
 */
async function judgeFilledTarget(
  db: unknown,
  dialect: SupportedDialect,
  target: UniqueTarget,
  origin: { table: string; value: string }
): Promise<UniqueColumnRepeats | undefined> {
  const { table, entity, ownField } = await ownedLiveTable(
    db,
    dialect,
    origin.table,
    target.column
  );
  if (table === undefined) return undefined;
  const [row] = await querySqlRows<{ entries: unknown }>(
    db,
    dialect,
    sql`SELECT COUNT(*) AS ${sql.identifier("entries")} FROM ${sql.identifier(table.name)}`
  );
  const entries = Number(row?.entries ?? 0);
  if (entries < 2) return undefined;
  return {
    entity: entity ?? { kind: "table", slug: table.name },
    field: ownField ?? target.column,
    table: table.name,
    column: target.column,
    repeats: [{ value: origin.value, entries }],
    showValues: false,
  };
}

/**
 * Where a target is judged: before the file runs (`live`, `filled`), or at its own statement,
 * over the values the statements before it leave (`atStatement`): one whose statement is not read
 * whole, whose table an earlier statement writes, or whose origin is not read with certainty.
 */
function judgedWhere(
  statements: readonly string[],
  dialect: SupportedDialect,
  target: UniqueTarget
): TargetOrigin {
  if (!target.exact) return AT_STATEMENT;
  if (writtenBefore(statements, dialect, target.table, target.at)) {
    return AT_STATEMENT;
  }
  return liveOrigin(statements, dialect, target);
}

/**
 * Refuse, before any of its statements runs, a migration file that makes a column unique while
 * the column's entries repeat a value. Each single-column unique index the file creates, read whole
 * (`uniqueIndexesReadIn`), is judged over a column the table already has and no unique index
 * holds, under the names the file's earlier renames start from (`liveOrigin`), or over a column the
 * file adds with a constant default, which repeats once the table holds two rows. Any other is
 * judged at its statement instead (`uniqueIndexCheckpoint`), over the values the statements before
 * it leave.
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
    const origin = judgedWhere(statements, dialect, target);
    const found =
      origin.kind === "live"
        ? await judgeUniqueTarget(db, dialect, origin)
        : origin.kind === "filled"
          ? await judgeFilledTarget(db, dialect, target, origin)
          : undefined;
    if (found !== undefined) refused.push(found);
  }
  if (refused.length > 0) throw uniqueColumnRepeatsError(refused, source);
}

/**
 * The check a unit's runner makes before each statement, for each unique index not judged before
 * the file runs (`judgedWhere`), and each over a column the file adds, through the handle the
 * statements run on (the transaction's, when there is one): the values the statements before it
 * leave. Undefined when the unit has no such index, so a runner pays nothing for it. Outside a
 * transaction the statements before it have run and stay applied, and the refusal says so.
 */
export function uniqueIndexCheckpoint(
  statements: readonly string[],
  dialect: SupportedDialect,
  unit: MigrationUnit
): ((db: unknown, index: number) => Promise<void>) | undefined {
  const atStatement = uniqueTargets(statements, dialect).filter(
    target => judgedWhere(statements, dialect, target).kind !== "live"
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
 * INDEX naming `index`, MySQL's DROP INDEX on the table, whose index is not read here, a DROP INDEX
 * whose names are not read (`dropIndexMayReach`), MySQL's
 * RENAME TABLE, PostgreSQL's ALTER INDEX renaming `index` away (or any one not read here), or an
 * ALTER TABLE on it that drops or renames anything (a column, a constraint, an index), which may
 * take the index with it.
 */
/**
 * Whether a DROP INDEX the index-name reading did not match may still drop an index of `table`:
 * MySQL's, which names the table, when it names this one, and any one whose names are not read
 * here (a schema-qualified index, say), which may name it.
 */
function dropIndexMayReach(
  statement: string,
  dialect: SupportedDialect,
  table: string
): boolean {
  if (indexesDroppedBy(statement, dialect) !== undefined) return false;
  return tablesChangedIn(statement, dialect)?.includes(table) ?? true;
}

function dropsTableOrIndex(
  statement: string,
  dialect: SupportedDialect,
  table: string,
  index: string
): boolean {
  if (tablesDroppedBy(statement, dialect)?.includes(table)) return true;
  if (indexesDroppedBy(statement, dialect)?.includes(index)) return true;
  if (/^\s*ALTER\s+INDEX\b/i.test(statement)) {
    const renamed = indexesRenamedBy(statement, dialect);
    return renamed === undefined || renamed[0] === index;
  }
  if (/^\s*DROP\s+INDEX\b/i.test(statement)) {
    return dropIndexMayReach(statement, dialect, table);
  }
  const onTable = tablesChangedIn(statement, dialect)?.includes(table) === true;
  // MySQL's RENAME TABLE moves the table, with its indexes, away from the name a later create
  // makes the index on. Its targets are not read here, so any one counts.
  if (/^\s*RENAME\s+TABLE\b/i.test(statement)) return true;
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
 * carries nothing to adopt, and an index the database cannot use (not valid or not ready) is not
 * adopted.
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
    // PostgreSQL keeps the index a failed or interrupted `CREATE INDEX CONCURRENTLY` left behind,
    // under its name, but checks no value against it: such an index is not the file's, and the
    // file's create runs and meets it.
    const unusable = await introspectUnusableIndexes(db, dialect, [
      created.table,
    ]);
    // Only an index holding the whole column, as the file's does: one with a predicate or over an
    // expression leaves values outside it free to repeat.
    const there = live.tables[0]?.indexes?.some(
      index =>
        index.unique &&
        index.where === undefined &&
        index.expression === undefined &&
        !unusable.has(index.name.toLowerCase()) &&
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
