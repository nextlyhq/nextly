/**
 * What a type change's conversion is refused for beyond its values (`type-conversion`): what the
 * tables it writes carry that it would set off, break or lose without saying so. Read from the
 * database, nothing changed, and asked before any statement: of a save before anything is written,
 * of each change `nextly migrate` deploys and `migrate:down` rolls back before its first file, and
 * again by the conversion where it runs.
 *
 * What the database itself refuses inside the file's transaction, nothing changed, is left to it: on
 * PostgreSQL a view, policy, generated column, trigger, rule or key naming the column, and an index the
 * new type has no operator class for.
 *
 * @module domains/schema/builder-save/conversion-refusals
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { mysqlSeesEveryTriggerQuery } from "../busy-table/run-unit";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import {
  readUpdateRules,
  readUpdateTriggers,
} from "../pipeline/live-table-facts";
import type {
  JudgedFieldTypeChange,
  TypeChangeRefusal,
} from "../value-conversion/type-change/field-type-changes";

import { namesColumn, sqliteReadersIn } from "./column-readers";
import type { ConvertedColumn } from "./type-conversion";

/** The column a conversion writes beside the one it converts, of the new type. */
export const BESIDE = "__nextly_converted";

/** What a conversion's refusals are asked of. */
interface ConversionAsked<Column extends ConvertedColumn = ConvertedColumn> {
  /** The columns it converts. */
  columns: readonly Column[];
  /** The judged changes of those columns. */
  judged: readonly JudgedFieldTypeChange[];
  /** On SQLite, the columns the column beside takes the place of. */
  swapped: readonly Column[];
}

/** What a conversion's refusals answer. */
interface ConversionAnswer<Column extends ConvertedColumn> {
  refusals: TypeChangeRefusal[];
  /**
   * The columns left to the file's own statement, which reaches every reading of theirs
   * (`castReaches`): those the conversion would be refused over, where that statement sets off and
   * loses nothing.
   */
  leftToCast: Column[];
}

/**
 * Every refusal of a conversion for what its tables carry: a column left by a conversion that
 * stopped part-way; update triggers and rules; a CHECK constraint naming a column written anew; a unique
 * JSON on SQLite; a default or a collation the column's new type would lose; and on SQLite what a
 * column swap would stop part-way over. Each names its field, and what stops it. A column whose
 * values the file's own statement reaches is not refused for what only a conversion sets off or
 * breaks: it is left to that statement instead, refused only for what that would lose
 * (`lostToCast`).
 */
export async function conversionRefusals<Column extends ConvertedColumn>(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  asked: ConversionAsked<Column>
): Promise<ConversionAnswer<Column>> {
  // Only SQLite puts the column beside in a column's place.
  const of = dialect === "sqlite" ? asked : { ...asked, swapped: [] };
  const refusals = [
    ...(await leftColumns(db, dialect, label, of.columns)),
    ...(await overSwapDependents(db, label, of.swapped)),
    ...(await overWritten(
      db,
      dialect,
      label,
      narrowed(of, column => !column.castReaches)
    )),
  ];
  const leftToCast: Column[] = [];
  for (const column of of.columns.filter(each => each.castReaches)) {
    const one = narrowed(of, each => each === column);
    const lost = await lostToCast(db, dialect, label, one);
    refusals.push(...lost);
    if (lost.length > 0) continue;
    if ((await overWritten(db, dialect, label, one)).length > 0) {
      leftToCast.push(column);
    }
  }
  return { refusals, leftToCast };
}

/** What is asked of `of`, for the columns `keeps` says. */
function narrowed<Column extends ConvertedColumn>(
  of: ConversionAsked<Column>,
  keeps: (column: Column) => boolean
): ConversionAsked<Column> {
  const columns = of.columns.filter(keeps);
  return {
    columns,
    judged: of.judged.filter(change =>
      columns.some(
        column =>
          column.table === change.table && column.column === change.column
      )
    ),
    swapped: of.swapped.filter(column => columns.includes(column)),
  };
}

/** The refusals of writing the columns' values and giving the columns their new type. */
async function overWritten(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  of: ConversionAsked
): Promise<TypeChangeRefusal[]> {
  return [
    ...(await overUpdateTriggers(db, dialect, label, of.judged)),
    ...(await overUpdateRules(db, dialect, label, of.judged)),
    ...(await overChecks(db, dialect, label, of)),
    ...(await overCarried(db, dialect, label, of)),
  ];
}

/** A refusal of `field`'s change, saying why. */
function refused(field: string, message: string): TypeChangeRefusal {
  return { path: field, code: "TYPE_CHANGE_BLOCKED", message };
}

/** How a refusal opens: which change, of which field, between which types. */
function cannotChange(label: string, change: JudgedFieldTypeChange): string {
  return `${label}: field '${change.to.name}' cannot change from ${change.from.type} to ${change.to.type}`;
}

/**
 * A table that still has the column a conversion writes into (`BESIDE`): one left by a conversion
 * that stopped part-way, which may hold the only copy of a column's values. Nothing is written over
 * it; the person finishes or undoes that conversion first.
 */
async function leftColumns(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  columns: readonly ConvertedColumn[]
): Promise<TypeChangeRefusal[]> {
  const left: TypeChangeRefusal[] = [];
  for (const column of columns) {
    const names = await columnNamesOf(db, dialect, column.table);
    for (const name of names.filter(each => each.startsWith(BESIDE))) {
      left.push(
        refused(
          column.field,
          `${label}: ${column.table}.${name} was left by a type change that stopped part-way, and may hold the only copy of a column's values, so nothing was changed. Put those values back where they belong and drop the column, then try again.`
        )
      );
    }
  }
  return left;
}

/**
 * A table that has update triggers, named, before any value is written: the conversion writes the
 * table's rows one batch at a time, and each update fires the table's triggers, which would run the
 * site's own code once for each value converted. On MySQL, which lists a table's triggers only to an
 * account holding `TRIGGER` on it while a row change still fires them, an account that cannot see
 * every trigger of the database is refused too: an empty list there says nothing (`unseenTriggers`).
 */
async function overUpdateTriggers(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  converted: readonly JudgedFieldTypeChange[]
): Promise<TypeChangeRefusal[]> {
  if (converted.length === 0) return [];
  const unseen = await unseenTriggers(db, dialect, label, converted);
  if (unseen.length > 0) return unseen;
  return overEachTable(
    label,
    converted,
    table => readUpdateTriggers(db, dialect, table),
    (table, fired) =>
      `${table} has ${fired.length === 1 ? "a trigger that fires" : "triggers that fire"} on every row it writes`
  );
}

/**
 * A table that has PostgreSQL rules on UPDATE, named, before any value is written: such a rule rewrites
 * the conversion's updates, so one that does nothing for a row leaves that row's value out of the column
 * beside, and the column would take none; one that does something more runs it for each value converted.
 * A disabled rule rewrites nothing, and an INSERT's or a DELETE's none of a conversion's statements.
 */
function overUpdateRules(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  converted: readonly JudgedFieldTypeChange[]
): Promise<TypeChangeRefusal[]> {
  return overEachTable(
    label,
    converted,
    table => readUpdateRules(db, dialect, table),
    (table, rules) =>
      `${table} has ${rules.length === 1 ? "a rule that rewrites" : "rules that rewrite"} every update of it, which may leave a row as it was`
  );
}

/**
 * The refusal of each of `converted` whose table carries something (`read`, once a table) that its
 * writes would set off, naming each: `says` how the table carries them.
 */
async function overEachTable(
  label: string,
  converted: readonly JudgedFieldTypeChange[],
  read: (table: string) => Promise<string[]>,
  says: (table: string, names: readonly string[]) => string
): Promise<TypeChangeRefusal[]> {
  const namesOf = new Map<string, string[]>();
  const refusals: TypeChangeRefusal[] = [];
  for (const change of converted) {
    let names = namesOf.get(change.table);
    if (names === undefined) {
      names = await read(change.table);
      namesOf.set(change.table, names);
    }
    if (names.length === 0) continue;
    refusals.push(
      refused(
        change.to.name,
        `${cannotChange(label, change)}: the change writes each of its values again, and ${says(change.table, names)} (${names.join(", ")}). Drop or disable ${names.length === 1 ? "it" : "them"} first, then try again.`
      )
    );
  }
  return refusals;
}

/**
 * On MySQL, a conversion run by an account that cannot see every trigger of the database
 * (`mysqlSeesEveryTriggerQuery`, as `triggerTables` asks it): a table's update trigger it does not
 * see would fire on every row the conversion writes. Each converted field is named.
 */
async function unseenTriggers(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  converted: readonly JudgedFieldTypeChange[]
): Promise<TypeChangeRefusal[]> {
  if (dialect !== "mysql") return [];
  const seen = await querySqlRows<{ seen: unknown }>(
    db,
    dialect,
    mysqlSeesEveryTriggerQuery()
  );
  if (seen.length > 0) return [];
  return converted.map(change =>
    refused(
      change.to.name,
      `${cannotChange(label, change)}: the change writes each of its values again, and this database account cannot see whether ${change.table} has triggers that would fire on every row it writes, as MySQL lists a table's triggers only to an account holding TRIGGER on it. Grant the account TRIGGER on the database, or make the change as one that holds it.`
    )
  );
}

/**
 * A column a named CHECK constraint of its table names, such as the one a field's validation put on
 * a table an earlier version made (`chk_<table>_validation`), where the change gives the column
 * another kind of value or writes any of its values in another form: it was written for the old
 * type's values, and no statement of the change drops it. PostgreSQL would refuse to give the
 * column a type its comparison does not take, SQLite the rebuild that would drop it, and MySQL a
 * reading it does not allow, once the column was emptied for it and with nothing to roll back.
 * Where the kind stays and every value is kept as it is, the check reads each as before, as a
 * column repair judges it (`kindChanges`).
 */
async function overChecks(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  of: ConversionAsked
): Promise<TypeChangeRefusal[]> {
  const readAnew = of.columns.filter(
    column => column.changesKind || rewritesAnyValue(column, of.judged)
  );
  const live = await introspectLiveSnapshot(db, dialect, [
    ...new Set(readAnew.map(column => column.table)),
  ]);
  return readAnew.flatMap(column => {
    const naming = (
      live.tables.find(table => table.name === column.table)?.checks ?? []
    )
      .filter(check => namesColumn(check.sql, column.column, dialect))
      .map(check => check.name);
    if (naming.length === 0) return [];
    const many = naming.length > 1;
    return [
      refused(
        column.field,
        `${label}: field '${column.field}' cannot change type while the CHECK ${many ? "constraints" : "constraint"} ${naming.join(", ")} on ${column.table} ${many ? "read" : "reads"} its values as the old type holds them. Drop ${many ? "them" : "it"} first, then try again.`
      ),
    ];
  });
}

/** Whether the judgement writes any value of `column` in another form than it holds. */
function rewritesAnyValue(
  column: ConvertedColumn,
  judged: readonly JudgedFieldTypeChange[]
): boolean {
  return judged.some(
    change =>
      change.table === column.table &&
      change.column === column.column &&
      change.result.counts.changed > 0
  );
}

/**
 * A property of the column the change would weaken or lose and say nothing of:
 * - a Unique field becoming JSON on SQLite, which keeps JSON as its text, so the unique index would
 *   compare each value's writing and let two equal values through;
 * - a default, or a collation other than its type's own, on a column that takes another type: the
 *   column of the new type is made with neither (`swapIn`).
 */
async function overCarried(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  of: ConversionAsked
): Promise<TypeChangeRefusal[]> {
  const refusals: TypeChangeRefusal[] = [];
  for (const change of of.judged) {
    const column = of.columns.find(
      each => each.table === change.table && each.column === change.column
    );
    if (column === undefined) continue;
    const reasons = [
      ...uniqueJsonReasons(dialect, change),
      ...(column.keepsType && !of.swapped.includes(column)
        ? []
        : await lostReasons(db, dialect, change)),
      ...(column.takesPlaceOnSqlite && of.swapped.includes(column)
        ? await lostNotNull(db, change)
        : []),
    ];
    refusals.push(
      ...reasons.map(reason =>
        refused(change.to.name, `${cannotChange(label, change)}: ${reason}`)
      )
    );
  }
  return refusals;
}

/** Why a Unique field cannot become JSON on SQLite, where it would. */
function uniqueJsonReasons(
  dialect: SupportedDialect,
  change: JudgedFieldTypeChange
): string[] {
  return dialect === "sqlite" &&
    change.to.unique === true &&
    change.toType.family === "json"
    ? [
        "SQLite keeps JSON as its text, so its Unique setting would compare the writing of each value and let two equal values through. Turn Unique off first, then try again.",
      ]
    : [];
}

/** Why a column taking another type would lose a property of its own: its default, its collation. */
async function lostReasons(
  db: unknown,
  dialect: SupportedDialect,
  change: JudgedFieldTypeChange
): Promise<string[]> {
  const carried = await carriedBy(db, dialect, change.table, change.column);
  return [
    ...(carried.default === undefined
      ? []
      : [
          `${change.table}.${change.column} has a default (${carried.default}), which the column would not keep. Remove the default first, then try again.`,
        ]),
    ...collationReasons(carried, change),
  ];
}

/** Why a column taking another type would lose the collation it carries, where it carries one. */
function collationReasons(
  carried: Carried,
  change: JudgedFieldTypeChange
): string[] {
  return carried.collation === undefined
    ? []
    : [
        `${carried.collation}, which the column would not keep${change.from.unique === true || change.to.unique === true ? ", and its Unique setting compares by it" : ""}. Give it the database's own collation first, then try again.`,
      ];
}

/** A PostgreSQL column type that compares by a collation. */
const COLLATED_TYPE = /^(text|varchar|character|char|bpchar|citext)\b/i;

/**
 * What the file's own statement would lose of a column and say nothing of, where its values need no
 * conversion: the collation a text compares by, where the new type compares by one too, or a Unique
 * JSON would compare by none. A number, a date or a checkbox has no collation to lose, and over a
 * default or a CHECK its new type does not take, the database refuses the statement itself.
 */
async function lostToCast(
  db: unknown,
  dialect: SupportedDialect,
  label: string,
  of: ConversionAsked
): Promise<TypeChangeRefusal[]> {
  const refusals: TypeChangeRefusal[] = [];
  for (const change of of.judged) {
    const column = of.columns.find(each => each.column === change.column);
    if (column === undefined || column.keepsType) continue;
    const compares =
      COLLATED_TYPE.test(column.type) ||
      (change.to.unique === true && change.toType.family === "json");
    if (!compares) continue;
    const carried = await carriedBy(db, dialect, change.table, change.column);
    refusals.push(
      ...collationReasons(carried, change).map(reason =>
        refused(change.to.name, `${cannotChange(label, change)}: ${reason}`)
      )
    );
  }
  return refusals;
}

/**
 * Why a SQLite column that nothing but the conversion gives its new type would lose its NOT NULL: the
 * column that takes its place is added taking no value, and no rebuild of its table follows to state
 * the constraint again.
 */
async function lostNotNull(
  db: unknown,
  change: JudgedFieldTypeChange
): Promise<string[]> {
  const [found] = await querySqlRows<{ required: number }>(
    db,
    "sqlite",
    sql`SELECT "notnull" AS required FROM pragma_table_info(${change.table}) WHERE lower(name) = ${change.column.toLowerCase()}`
  );
  return Number(found?.required ?? 0) === 0
    ? []
    : [
        `${change.table}.${change.column} is NOT NULL, which SQLite's column of the new type, put in its place, would not keep. Rename the field and save first, then change its type.`,
      ];
}

/** A column's default, and a collation it compares by that is not its type's own, as words. */
interface Carried {
  default?: string;
  collation?: string;
}

/** What `column` of `table` carries, where a database that rewrites values keeps it. */
function carriedBy(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
): Promise<Carried> {
  if (dialect === "postgresql") return postgresCarried(db, table, column);
  if (dialect === "sqlite") return sqliteCarried(db, table, column);
  // MySQL's column is given its type with its own character set and collation (`mysqlColumnFacts`),
  // and no road rewrites values there (`rewritesValuesOn`).
  return Promise.resolve({});
}

/** A PostgreSQL column's default, and its collation where its type's own is another. */
async function postgresCarried(
  db: unknown,
  table: string,
  column: string
): Promise<Carried> {
  const [row] = await querySqlRows<{
    default_expr: string | null;
    collation: string | null;
  }>(
    db,
    "postgresql",
    sql`SELECT pg_get_expr(d.adbin, d.adrelid) AS default_expr, c.collname AS collation
        FROM pg_attribute a
        JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        LEFT JOIN pg_collation c ON c.oid = a.attcollation AND a.attcollation <> t.typcollation
        WHERE a.attrelid = to_regclass(quote_ident(${table}))
          AND a.attname = ${column} AND NOT a.attisdropped`
  );
  return {
    ...(row?.default_expr == null ? {} : { default: row.default_expr }),
    ...(row?.collation == null
      ? {}
      : {
          collation: `${table}.${column} compares by the collation ${row.collation}`,
        }),
  };
}

/**
 * A SQLite column's default, and whether its table or any of its indexes states a collation. SQLite
 * reports a column's collation only in the table's stored statement, so any there counts, whichever
 * column it is of, as the table's rebuild counts it.
 */
async function sqliteCarried(
  db: unknown,
  table: string,
  column: string
): Promise<Carried> {
  const [found] = await querySqlRows<{ default_value: string | null }>(
    db,
    "sqlite",
    sql`SELECT dflt_value AS default_value FROM pragma_table_info(${table}) WHERE lower(name) = ${column.toLowerCase()}`
  );
  const [made] = await querySqlRows<{ sql: string | null }>(
    db,
    "sqlite",
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND lower(name) = ${table.toLowerCase()}`
  );
  const indexed = await querySqlRows<{ coll: string }>(
    db,
    "sqlite",
    sql`SELECT ix.coll AS coll FROM pragma_index_list(${table}) AS il, pragma_index_xinfo(il.name) AS ix
        WHERE ix.key = 1 AND upper(ix.coll) <> 'BINARY'`
  );
  const collates = /\bCOLLATE\b/i.test(made?.sql ?? "") || indexed.length > 0;
  return {
    ...(found?.default_value == null ? {} : { default: found.default_value }),
    ...(collates
      ? { collation: `${table} states a collation of its own (COLLATE)` }
      : {}),
  };
}

/**
 * On SQLite, a column the conversion swaps for the column beside it (`swapsOnSqlite`) where the
 * swap's `DROP COLUMN` would stop part-way, or take with it what the column's own definition holds:
 * a view or a trigger whose text names the table; an index on the table over an expression or with a
 * condition; a UNIQUE constraint on the column, which SQLite keeps whole or refuses to drop a column
 * under; a foreign key on it or to it; and a CHECK or a generated column that reads it. Each is named.
 */
async function overSwapDependents(
  db: unknown,
  label: string,
  swapped: readonly ConvertedColumn[]
): Promise<TypeChangeRefusal[]> {
  const refusals: TypeChangeRefusal[] = [];
  for (const column of swapped) {
    const dependents = await sqliteSwapDependents(
      db,
      column.table,
      column.column
    );
    if (dependents.length === 0) continue;
    const one = dependents.length === 1;
    refusals.push(
      refused(
        column.field,
        `${label}: field '${column.field}' cannot change type in ${column.table}, whose column the change replaces with one of the new type, while ${dependents.join(", ")} ${one ? "depends" : "depend"} on the table. Drop ${one ? "it" : "them"} first, then try again.`
      )
    );
  }
  return refusals;
}

/**
 * What on SQLite depends on `table` beyond the plain indexes a column swap makes again: each view
 * and trigger whose text names it, each of its indexes over an expression or with a condition, a
 * UNIQUE constraint on `column`, whose index SQLite made itself and drops with no column, and what
 * the column carries besides its type (`sqliteForeignKeys`, `sqliteReadersOf`).
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
  return [
    ...dependents,
    ...(await sqliteForeignKeys(db, table, column)),
    ...(await sqliteReadersOf(db, table, column)),
  ];
}

/** The foreign keys on `column` of a SQLite `table`, and those of other tables to it. */
async function sqliteForeignKeys(
  db: unknown,
  table: string,
  column: string
): Promise<string[]> {
  const named = column.toLowerCase();
  const own = await querySqlRows<{ references_table: string }>(
    db,
    "sqlite",
    sql`SELECT "table" AS references_table FROM pragma_foreign_key_list(${table}) WHERE lower("from") = ${named}`
  );
  const to = await querySqlRows<{ name: string }>(
    db,
    "sqlite",
    sql`SELECT DISTINCT m.name AS name FROM sqlite_master AS m, pragma_foreign_key_list(m.name) AS f
        WHERE m.type = 'table' AND lower(f."table") = ${table.toLowerCase()} AND lower(f."to") = ${named}`
  );
  return [
    ...own.map(
      key => `the foreign key of ${column} to ${key.references_table}`
    ),
    ...to.map(key => `the foreign key of ${key.name} to ${column}`),
  ];
}

/**
 * What of a SQLite `table` reads `column` (`sqliteReadersIn`): SQLite states a CHECK and a generated
 * column only in the table's own statement, and drops a column's own CHECK with it without a word.
 */
async function sqliteReadersOf(
  db: unknown,
  table: string,
  column: string
): Promise<string[]> {
  const [made] = await querySqlRows<{ sql: string | null }>(
    db,
    "sqlite",
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND lower(name) = ${table.toLowerCase()}`
  );
  return sqliteReadersIn(made?.sql ?? "", column);
}

/** `text` with every character a regular expression gives a meaning escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
