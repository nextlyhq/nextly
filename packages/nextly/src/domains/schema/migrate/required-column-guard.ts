/**
 * `nextly migrate` refusing a migration file that makes a column required over rows that would
 * break it, naming the entity, the field and the count.
 *
 * The file's statements are read once (`readNotNullChanges`), and each change is counted
 * where its count is the truth:
 *
 * - Before any statement of the file runs (`refuseRequiredColumnsOverNulls`), for a change no
 *   earlier statement of the file writes rows for. Nothing has run and nothing is recorded, on
 *   every dialect, MySQL included, where a statement that ran would stay applied.
 * - At the statement itself (`requiredColumnCheckpoint`, called by the runner before each
 *   statement), for a change an earlier statement of the file fills: the rows still null after
 *   that fill are the ones that break it. On PostgreSQL and SQLite it is counted inside the
 *   file's transaction, which the refusal rolls back; on MySQL the statements before it have run,
 *   and the refusal names them.
 *
 * A table is judged only when the registry names it as a collection's, a Single's or a field
 * group's (`dynamic_collections`, `dynamic_singles`, `dynamic_components`); Nextly's own tables
 * have the core reconcile, and a plugin's are its own. A column maps to its field through the
 * column descriptor. A field group's rows are counted by the collection or Single that holds
 * them (`_parent_table`), so the refusal names each with its count.
 *
 * @module domains/schema/migrate/required-column-guard
 */
import { sql } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  countRowsBreakingNotNull,
  querySqlRows,
  type RowsBreakingNotNull,
} from "../pipeline/classifier/count-helpers";
import {
  introspectLiveColumns,
  introspectTableNames,
} from "../pipeline/diff/introspect-live";
import {
  requiredColumnBreakMessage,
  requiredColumnOverNullsError,
  type RequiredColumnBreak,
  type RequiredColumnEntity,
  requiredColumnUncountedError,
} from "../required-column-refusal";
import {
  fieldsByColumnOf,
  requiredColumnRegistries,
} from "../required-column-registries";

import type { MigrationUnit } from "./migration-transaction";
import { readNotNullChanges } from "./not-null-statements";
import { splitSqlStatements } from "./split-sql";
import { labelOf } from "./statement-judgement";

/** One column to count: its table and column as they stand when counted. */
export interface RequiredColumnTarget {
  table: string;
  /** The column whose null rows break it; `null` for an added column, which every row breaks. */
  column: string | null;
  /** The column the change leaves required, which a field maps to. */
  required: string;
  /**
   * The column was added `IF NOT EXISTS` and empty: counted as it is when it is there, and as an
   * added column, which every row breaks, when it is not.
   */
  addedIfMissing?: boolean;
  /**
   * The qualifier the statement names the table through (`s.t`): read as the table when the
   * database says it is the table's own schema (`plainQualifier`), refused otherwise.
   */
  qualifier?: string;
}

/** A table the registry names, with the entity it belongs to. */
interface TableOwner {
  entity: RequiredColumnEntity;
  /** The table's name as the registry records it. */
  table: string;
  fieldGroup: boolean;
  /** Each field's column, lower-cased, to the field's name. */
  fieldsByColumn: Map<string, string>;
}

/** The registry's entities, by table. Names are compared lower-cased. */
export interface RequiredColumnOwners {
  /** The collection, Single or field group whose table this is, or undefined. */
  owner(table: string): TableOwner | undefined;
  /** The collection or Single whose table this is: a field group row's `_parent_table`. */
  holder(table: string): RequiredColumnEntity | undefined;
}

/** What the judgement reads of the database, injected so it can be judged without one. */
export interface RequiredColumnFacts {
  owners: RequiredColumnOwners;
  /**
   * The live column, by the owner's table name and the column name lower-cased: undefined when
   * the table or the column is not there. `null` column asks for the table alone. `name` and
   * `table` are the column's and the table's names as the database spells them, which the count
   * uses: a quoted mixed-case name is read lower-cased from a statement.
   */
  live(
    table: string,
    column: string | null
  ): { nullable: boolean; name?: string; table?: string } | undefined;
  /**
   * Whether a qualifier names the schema an unqualified name reaches, so `q.t` is `t`: SQLite's
   * `main`, MySQL's current database. On PostgreSQL no qualifier is read as one, since which schema
   * an unqualified name reaches depends on the search path.
   */
  plainQualifier(qualifier: string): boolean;
  count(target: {
    table: string;
    column: string | null;
    byParent: boolean;
  }): Promise<RowsBreakingNotNull>;
}

/**
 * The columns that would break, counted for each target: the one judgement both the pre-run
 * and the at-statement count make. A target on a table the registry does not name is left
 * alone; one whose column is not on the table, or is already NOT NULL, has no row to break
 * (a statement on a column that is not there fails on its own). A count that fails refuses,
 * naming the table, rather than letting an uncounted change run.
 */
export async function judgeRequiredColumnTargets(
  targets: readonly RequiredColumnTarget[],
  facts: RequiredColumnFacts
): Promise<RequiredColumnBreak[]> {
  const breaks: RequiredColumnBreak[] = [];
  for (const target of targets) {
    const found = await judgeTarget(target, facts);
    if (found !== undefined) breaks.push(found);
  }
  return breaks;
}

/** One column's break, or undefined when no row is in its way. */
async function judgeTarget(
  target: RequiredColumnTarget,
  facts: RequiredColumnFacts
): Promise<RequiredColumnBreak | undefined> {
  // A table that is not a collection, a Single or a field group (a plugin's, an extension's) is
  // judged too, and named by its table and column.
  // A qualifier that may reach another schema names rows nothing here counts.
  if (
    target.qualifier !== undefined &&
    !facts.plainQualifier(target.qualifier)
  ) {
    throw requiredColumnUncountedError({
      table: `${target.qualifier}.${target.table}`,
      field: target.required,
      cause: undefined,
      through: target.qualifier,
    });
  }
  const owner = facts.owners.owner(target.table);
  const live = liveTarget(target, owner?.table ?? target.table, facts);
  if (live === undefined) return undefined;
  // The field the column belongs to, named the same whether the count answers or fails.
  const field = owner === undefined ? target.required : fieldOf(owner, target);
  const rows = await countTarget(live, owner, facts, field);
  if (rows.total === 0) return undefined;
  if (owner === undefined) {
    return {
      entity: { kind: "table", slug: live.table },
      field,
      count: rows.total,
      added: live.column === null,
    };
  }
  return {
    entity: owner.entity,
    field,
    count: rows.total,
    added: live.column === null,
    ...(owner.fieldGroup ? { users: usersOf(rows, facts) } : {}),
  };
}

/** A target as the database stands: what is counted, under the names the database spells. */
interface LiveTarget {
  table: string;
  /** The live column whose null rows break it, or `null` for an added one, which every row breaks. */
  column: string | null;
}

/**
 * What a target counts as the database stands, or undefined when the change can break no row
 * whatever the table holds: a table or column not there (a statement on a column that is not
 * there fails on its own), a column already NOT NULL, or a column added NOT NULL that the table
 * already has (`ADD COLUMN IF NOT EXISTS`, which the database then skips). A column added
 * `IF NOT EXISTS` and empty is counted as it is, or as added when it is not there.
 */
function liveTarget(
  target: RequiredColumnTarget,
  table: string,
  facts: RequiredColumnFacts
): LiveTarget | undefined {
  if (target.column === null) {
    const live = facts.live(table, null);
    if (
      live === undefined ||
      facts.live(table, target.required) !== undefined
    ) {
      return undefined;
    }
    return {
      table: live.table ?? table,
      column: null,
    };
  }
  const live = facts.live(table, target.column);
  if (live === undefined) {
    return target.addedIfMissing === true
      ? liveTarget({ ...target, column: null }, table, facts)
      : undefined;
  }
  if (!live.nullable) return undefined;
  return {
    table: live.table ?? table,
    column: live.name ?? target.column,
  };
}

/** The field a registered table's column belongs to, by the name it leaves or had. */
function fieldOf(owner: TableOwner, target: RequiredColumnTarget): string {
  return (
    owner.fieldsByColumn.get(target.required) ??
    (target.column === null
      ? undefined
      : owner.fieldsByColumn.get(target.column)) ??
    target.required
  );
}

/** The rows in the way, counted; a count that fails refuses, naming the table and `field`. */
async function countTarget(
  live: LiveTarget,
  owner: TableOwner | undefined,
  facts: RequiredColumnFacts,
  field: string
): Promise<RowsBreakingNotNull> {
  try {
    return await facts.count({
      table: live.table,
      column: live.column,
      byParent: owner?.fieldGroup === true,
    });
  } catch (cause) {
    throw requiredColumnUncountedError({ table: live.table, field, cause });
  }
}

/**
 * A field group's users with the rows each holds; a row whose parent table the registry does not
 * name is still counted in the total.
 */
function usersOf(
  rows: RowsBreakingNotNull,
  facts: RequiredColumnFacts
): Array<RequiredColumnEntity & { count: number }> {
  return [...rows.byParentTable].flatMap(([table, count]) => {
    const holder = facts.owners.holder(table);
    return holder === undefined ? [] : [{ ...holder, count }];
  });
}

/** A registry row's `fields`, which a dialect returns as JSON text or as the parsed value. */
function fieldsOf(raw: unknown): FieldDefinition[] {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(value) ? (value as FieldDefinition[]) : [];
}

/**
 * The registry's collections, Singles and field groups, read through `db`: the handle a count
 * runs on, so inside a file's transaction it reads what the transaction sees. A registry table
 * the database does not have records nothing.
 */
export async function readRequiredColumnOwners(
  db: unknown,
  dialect: SupportedDialect
): Promise<RequiredColumnOwners> {
  // The registries as every road reads them: the field-group one under its resolved name.
  const registries = (await requiredColumnRegistries(db, dialect)).map(
    ([kind, table]) => ({ kind, table })
  );
  const present = new Set(
    (
      await introspectTableNames(
        db,
        dialect,
        registries.map(r => r.table)
      )
    ).map(name => name.toLowerCase())
  );
  const owners = new Map<string, TableOwner>();
  for (const registry of registries) {
    if (!present.has(registry.table.toLowerCase())) continue;
    const rows = await querySqlRows<{
      slug: string;
      table_name: string;
      fields: unknown;
    }>(
      db,
      dialect,
      sql`SELECT ${sql.identifier("slug")} AS slug, ${sql.identifier("table_name")} AS table_name, ${sql.identifier("fields")} AS fields FROM ${sql.identifier(registry.table)}`
    );
    const fieldGroup = registry.kind === "fieldGroup";
    for (const row of rows) {
      const fieldsByColumn = fieldsByColumnOf(
        fieldsOf(row.fields),
        dialect,
        fieldGroup
      );
      owners.set(String(row.table_name).toLowerCase(), {
        entity: { kind: registry.kind, slug: String(row.slug) },
        table: String(row.table_name),
        fieldGroup,
        fieldsByColumn,
      });
    }
  }
  return {
    owner: table => owners.get(table.toLowerCase()),
    holder: table => {
      const owner = owners.get(table.toLowerCase());
      return owner === undefined || owner.fieldGroup ? undefined : owner.entity;
    },
  };
}

/** The facts of the database `db` reaches, for the targets on tables the registry names. */
async function readFacts(
  db: unknown,
  dialect: SupportedDialect,
  targets: readonly RequiredColumnTarget[]
): Promise<RequiredColumnFacts> {
  const owners = await readRequiredColumnOwners(db, dialect);
  const tables = [
    ...new Set(targets.map(t => owners.owner(t.table)?.table ?? t.table)),
  ];
  // Read under the database's own spelling: a quoted mixed-case name is read lower-cased from a
  // statement, and a PostgreSQL catalog read by that name would find no table.
  const spelled = await introspectTableNames(db, dialect, tables);
  const snapshot = await introspectLiveColumns(db, dialect, spelled);
  const byName = new Map<
    string,
    { table: string; columns: Map<string, { name: string; nullable: boolean }> }
  >();
  for (const table of snapshot.tables) {
    const key = table.name.toLowerCase();
    // Two tables differing only in case: the one spelled as the statement reads it wins.
    if (byName.get(key)?.table === key) continue;
    byName.set(key, {
      table: table.name,
      columns: new Map(table.columns.map(c => [c.name.toLowerCase(), c])),
    });
  }
  const current =
    dialect === "mysql" && targets.some(t => t.qualifier !== undefined)
      ? await currentDatabase(db, dialect)
      : undefined;
  return {
    owners,
    plainQualifier: qualifier =>
      dialect === "sqlite"
        ? qualifier === "main"
        : dialect === "mysql" && qualifier === current,
    live: (table, column) => {
      const live = byName.get(table.toLowerCase());
      if (live === undefined) return undefined;
      if (column === null) return { nullable: true, table: live.table };
      const found = live.columns.get(column.toLowerCase());
      return found === undefined
        ? undefined
        : { nullable: found.nullable, name: found.name, table: live.table };
    },
    count: target => countRowsBreakingNotNull(db, dialect, target),
  };
}

/**
 * The facts for `targets`, read once: a read that fails (the registries, the catalog, the current
 * database) refuses as a count that fails does, naming the first target's table, so no road ends
 * with a bare introspection error for a change it could not judge.
 */
async function factsFor(
  db: unknown,
  dialect: SupportedDialect,
  targets: readonly RequiredColumnTarget[]
): Promise<RequiredColumnFacts> {
  try {
    return await readFacts(db, dialect, targets);
  } catch (cause) {
    const [first] = targets;
    throw requiredColumnUncountedError({
      table: first.table,
      field: first.required,
      cause,
    });
  }
}

/** MySQL's current database, lower-cased, as a statement's qualifier would be read. */
async function currentDatabase(
  db: unknown,
  dialect: SupportedDialect
): Promise<string | undefined> {
  const [row] = await querySqlRows<{ name: string | null }>(
    db,
    dialect,
    sql`SELECT DATABASE() AS name`
  );
  return row?.name?.toLowerCase() ?? undefined;
}

/** The statement a run stopped at, the file's statements, and whether they ran in a transaction. */
export interface StatementPosition {
  index: number;
  statements: readonly string[];
  transaction: boolean;
}

/**
 * The refusal, as the shared one names each column (`requiredColumnOverNullsError`), with a
 * message that says which file it was and what of it ran: nothing, when it was refused before
 * its first statement; at a statement, the statements before it, and whether they stayed.
 */
export function requiredColumnMigrationRefusal(
  breaks: readonly RequiredColumnBreak[],
  where: {
    source: string;
    dialect: SupportedDialect;
    at?: StatementPosition;
  }
): NextlyError {
  const base = requiredColumnOverNullsError(breaks, { source: where.source });
  const sentences = breaks.map(requiredColumnBreakMessage).join(" ");
  const { at } = where;
  return new NextlyError({
    code: base.code,
    publicMessage:
      at === undefined
        ? `${where.source} was refused before any of its statements ran, and nothing of it was applied: ${sentences}`
        : refusedAtStatement(where.source, where.dialect, at, sentences),
    publicData: base.publicData,
    logContext: {
      ...base.logContext,
      ...(at === undefined
        ? { phase: "before-any-statement" }
        : { phase: "at-statement", statement: at.index + 1 }),
    },
  });
}

/**
 * Where a refusal at a statement stopped the file, after `sentences` saying why: the statements
 * that ran before it, and what stayed of them. A transaction undoes them where the dialect can
 * undo a schema change; MySQL commits each schema change as it runs, and with it any rows
 * written before it.
 */
function refusedAtStatement(
  source: string,
  dialect: SupportedDialect,
  at: StatementPosition,
  sentences: string
): string {
  const label = (i: number) =>
    `${String(i + 1)}. ${labelOf(at.statements[i], dialect)}`;
  const ran = at.statements.slice(0, at.index).map((_, i) => label(i));
  const kept = !at.transaction
    ? "They ran outside a transaction, and stayed applied."
    : dialect === "mysql"
      ? "MySQL commits a schema change as it runs, so a schema change among them stayed applied, with any rows written before it; the rest was rolled back."
      : "The file's transaction was rolled back, so none of them stayed applied.";
  return `${source} was refused at its statement ${label(at.index)} (of ${String(at.statements.length)}): ${sentences} The statements that ran before it: ${ran.join("; ")}. ${kept}`;
}

/**
 * A count that failed at a statement, refused as a counted one is there: named with the
 * statements that ran before it and what stayed of them, since by then they have run. Any other
 * error is returned as it is.
 */
export function uncountedAtStatement(
  error: unknown,
  source: string,
  dialect: SupportedDialect,
  at: StatementPosition
): unknown {
  const issue = uncountedIssue(error);
  if (issue === undefined || !NextlyError.is(error)) return error;
  return new NextlyError({
    code: error.code,
    publicMessage: refusedAtStatement(source, dialect, at, issue),
    publicData: error.publicData,
    ...(error.cause === undefined ? {} : { cause: error.cause }),
    logContext: {
      ...error.logContext,
      source,
      phase: "at-statement",
      statement: at.index + 1,
    },
  });
}

/**
 * The columns a file would break before any of its statements runs: each change no earlier
 * statement of the file writes rows for, counted under the names it had before the file, and
 * skipped where the file itself created its table or column. Reads nothing when there is none.
 */
async function requiredColumnBreaksBeforeRun(
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[]
): Promise<RequiredColumnBreak[]> {
  const targets = readNotNullChanges(statements, dialect).flatMap(change =>
    change.writtenEarlier || change.before === null
      ? []
      : [
          {
            table: change.before.table,
            column: change.before.column,
            required: change.required,
            ...(change.before.addedIfMissing === true
              ? { addedIfMissing: true }
              : {}),
            ...(change.qualifier === undefined
              ? {}
              : { qualifier: change.qualifier }),
          },
        ]
  );
  if (targets.length === 0) return [];
  return judgeRequiredColumnTargets(
    targets,
    await factsFor(db, dialect, targets)
  );
}

/**
 * Refuses a migration file whose statements make a column required over rows that would break
 * it, before any of them runs and before the ledger records an attempt. `source` is the file's
 * name, as the refusal names it.
 */
export async function refuseRequiredColumnsOverNulls(
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[],
  source: string
): Promise<void> {
  const breaks = await requiredColumnBreaksBeforeRun(db, dialect, statements);
  if (breaks.length === 0) return;
  throw requiredColumnMigrationRefusal(breaks, { source, dialect });
}

/**
 * What `migrate --dry-run` says of a pending file: each column a real run would refuse it over
 * before running it, from the same count. A change the file fills first is counted only at its
 * statement, when the run gets there.
 *
 * Counted only for the first migration a run applies: a later one meets the database the
 * migrations before it leave, which a preview runs none of, so a count against the database as it
 * is now would refuse a file whose rows an earlier file fills, or miss a column an earlier file
 * adds. A later file that makes a column required says so instead, with no count.
 */
export async function previewRequiredColumns(
  db: unknown,
  dialect: SupportedDialect,
  file: { upSql: string; transaction: boolean },
  logger: { info(message: string): void },
  /** Migrations run before this one: plugin modules, or earlier pending files. */
  afterEarlier: boolean
): Promise<void> {
  const statements = splitSqlStatements(file.upSql, dialect, file);
  if (afterEarlier) {
    if (readNotNullChanges(statements, dialect).length > 0) {
      logger.info(
        "    • its required columns are counted when the run reaches it, after the migrations before it"
      );
    }
    return;
  }
  let breaks: RequiredColumnBreak[];
  try {
    breaks = await requiredColumnBreaksBeforeRun(db, dialect, statements);
  } catch (error) {
    // A file whose rows cannot be counted is one a real run would refuse: reported as a line of
    // the preview, not as the end of it. Anything else still fails the preview.
    const issue = uncountedIssue(error);
    if (issue === undefined) throw error;
    logger.info(`    ✖ a real run would refuse it: ${issue}`);
    return;
  }
  for (const b of breaks) {
    logger.info(
      `    ✖ a real run would refuse it: ${requiredColumnBreakMessage(b)}`
    );
  }
}

/** The sentence of a refusal over rows that could not be counted, or undefined for any other error. */
function uncountedIssue(error: unknown): string | undefined {
  if (!NextlyError.isValidation(error)) return undefined;
  const data = error.publicData as
    | { errors?: Array<{ code?: string; message?: string }> }
    | undefined;
  return data?.errors?.find(e => e.code === "REQUIRED_COLUMN_UNCOUNTED")
    ?.message;
}

/**
 * The count a unit's runner makes before each statement, for each change an earlier statement
 * of the unit writes rows for, through the handle the statements run on (the transaction's,
 * when there is one): the rows still null after the fill. Undefined when the unit has no such
 * change, so a runner pays nothing for it. A DOWN is judged as an UP is: it can make a column
 * required again over rows saved since its UP ran.
 */
export function requiredColumnCheckpoint(
  statements: readonly string[],
  dialect: SupportedDialect,
  unit: MigrationUnit
): ((db: unknown, index: number) => Promise<void>) | undefined {
  const byStatement = new Map<number, RequiredColumnTarget[]>();
  for (const change of readNotNullChanges(statements, dialect)) {
    if (!change.writtenEarlier) continue;
    const targets = byStatement.get(change.statement) ?? [];
    targets.push({
      table: change.table,
      column: change.column,
      required: change.required,
      ...(change.qualifier === undefined
        ? {}
        : { qualifier: change.qualifier }),
    });
    byStatement.set(change.statement, targets);
  }
  if (byStatement.size === 0) return undefined;
  return async (db, index) => {
    const targets = byStatement.get(index);
    if (targets === undefined) return;
    const at = { index, statements, transaction: unit.transaction };
    // Reading the facts and counting both come after the statements before this one have run,
    // so either failing says so.
    const breaks = await factsFor(db, dialect, targets)
      .then(facts => judgeRequiredColumnTargets(targets, facts))
      .catch((error: unknown) => {
        throw uncountedAtStatement(error, unit.source, dialect, at);
      });
    if (breaks.length === 0) return;
    throw requiredColumnMigrationRefusal(breaks, {
      source: unit.source,
      dialect,
      at,
    });
  };
}
