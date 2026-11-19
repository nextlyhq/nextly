/**
 * Whether a pending app migration may be recorded applied without running it, because the
 * database already stands where it ends and its snapshot proves every effect it has.
 *
 * A database brought to a file's end some other way (`db:sync` on a shared database, or by hand)
 * shows the file's schema changes as done. It shows nothing else: a snapshot records tables with
 * their columns, indexes, checks and foreign keys, and no rows, triggers, views, functions,
 * sequences, extensions or grants. So recording the file without running it is sound only when
 * three things hold:
 *
 * 1. Every statement changes only what the snapshot records (`statementsShownBySnapshot`). The
 *    statements that pass are a closed list, read through the shared statement cursor; anything
 *    else, a statement this reading does not know included, fails, so it is never skipped:
 *    - table and index DDL on a table either side of the snapshot holds: `CREATE TABLE` creating
 *      it empty, `CREATE [UNIQUE] INDEX`, `DROP TABLE`, `DROP INDEX` of an index the snapshot
 *      records, MySQL's `RENAME TABLE`, and `ALTER TABLE` whose every clause adds, drops,
 *      alters, renames or validates a column, constraint, index or key, or renames the table;
 *    - a table the file creates and drops or renames into place again (a SQLite rebuild's twin,
 *      the rebuild's guard table), the rebuild's copy of the table's own rows, and the carry of
 *      its AUTOINCREMENT sequence;
 *    - MySQL's four-statement run `migrate:create` writes to change a column's nullability or
 *      rename a column a check uses (`mysqlLiveRunAt`);
 *    - the registry row `migrate:create` writes for an entity whose table the snapshot holds,
 *      which `nextly migrate` writes from the snapshot anyway, and the statement it writes after
 *      a file's registry rows to move the stored schema version, which `nextly migrate` moves
 *      then too;
 *    - a session setting from a short list (lock and statement timeouts, foreign-key checks), a
 *      savepoint, and the SQLite pragmas a rebuild uses.
 * 2. Its checksum matches the one recorded with its snapshot when it was written, so it is the
 *    file the snapshot describes.
 * 3. It has no unresolved attempt.
 *
 * The live database is asked what the snapshot comparison cannot see (`proveStatements`): an
 * index or constraint it cannot use, rows a default would have filled, a key the file has the
 * database assign, and a MySQL column a statement restates that holds a setting the statement
 * would put back.
 *
 * Otherwise the run refuses before changing anything (`notProvenError`), naming the file, every
 * statement it would have skipped, and the next step.
 *
 * What the proof does not reach is the values rows hold. A column whose type the file changes with
 * a plain cast of itself, already at that type, is recorded with the values it has, however they
 * were converted: the file's cast could not run on it again. A column the file adds with a default
 * is recorded with the values its rows hold, where none is NULL: rows written since hold others.
 *
 * @module domains/schema/migrate/snapshot-proof
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { SchemaEventRow } from "../events/schema-events-repository";
import {
  createsEmptyTable,
  rebuildCopyStatements,
} from "../ownership/drop-guard";
import { diffSnapshots } from "../pipeline/diff/diff";
import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
} from "../pipeline/diff/types";
import {
  MYSQL_LIVE_RUN_LENGTH,
  mysqlLiveRunAt,
} from "../pipeline/sql-templates/mysql-live-restate";
import { literalOf } from "../pipeline/sql-templates/sqlite-swap";
import { schemaVersionStoreSql } from "../schema-version";
import { registryRowKeys } from "../ui-schema/registry-row-keys";

import {
  cursorOf,
  StatementCursor,
  type StatementToken,
} from "./statement-cursor";
import {
  judgeStatements,
  labelOf,
  type JudgedStatement,
  type LiveSchema,
  type LiveSchemaWithColumnFacts,
} from "./statement-judgement";
import { registryRowWrittenBy } from "./statement-targets";

/** One statement of a pending file, as the refusal names it. */
interface StatementProof {
  /** The statement's leading text, with no string literal's content (`labelOf`). */
  label: string;
  /**
   * `shown`: the snapshot shows what it does, and the database has it. `unshown`: the snapshot
   * cannot show what it does. `not-done`: the snapshot shows its kind, but the live database does
   * not stand as it leaves it (`judgeStatements`): an index left invalid, a constraint not
   * validated, an object absent, a key the file has the database assign that it does not.
   * `unfilled`: rows it fills with its default are still NULL. `keeps`: a MySQL column it restates
   * holds a setting a run of it would put back (`LiveColumnFacts.untrackedSettings`).
   */
  status: "shown" | "unshown" | "not-done" | "unfilled" | "keeps";
}

/** A column a statement fills, in every row the table already holds, with its default. */
interface FilledColumn {
  table: string;
  column: string;
}

/** What the live database says of a pending file's statements, where it stands at the file's end. */
export interface LiveFacts {
  /** The live schema the statements are judged against (`readLiveSchema`). */
  schema: LiveSchemaWithColumnFacts;
  /** How many rows hold NULL in `column` of `table` (`countNulls`). */
  nullsIn: (table: string, column: string) => Promise<number>;
}

/**
 * Each statement of a pending file the database stands at the end of, with what proves it
 * (`statementsShownBySnapshot`), the live database's word on it (`judgeStatements`), and, for a
 * statement that fills a nullable column's rows with its default, that no row still holds NULL
 * there: a database brought to the same schema by adding the column and setting its default
 * afterwards has the default and not the rows it would have filled. One count per such column, and
 * only here.
 *
 * Two more things the snapshot comparison cannot see are asked of the live database: that a key a
 * statement has the database assign is assigned there (`generatedKeysAssigned`), and that a MySQL
 * column a statement restates holds nothing the statement would put back (`restatedColumnsKeep`).
 * Every question about a column, the count of its NULL rows included, is asked where the rest of
 * the file leaves it (`whereItEnds`): each later rename of the column or of its table moves the
 * question with it, and a later statement that drops it, or that settles the same thing again,
 * ends it.
 */
export async function proveStatements(args: {
  statements: readonly string[];
  dialect: SupportedDialect;
  sides: { before: NextlySchemaSnapshot; target: NextlySchemaSnapshot };
  live: LiveFacts;
}): Promise<StatementProof[]> {
  const { statements, dialect, live } = args;
  const judged = judgeStatements(statements, dialect, live.schema);
  const proofs = statementsShownBySnapshot(
    statements,
    dialect,
    args.sides,
    judged
  );
  const filled = columnsFilledBy(statements, dialect);
  for (const [at, proof] of proofs.entries()) {
    if (proof.status !== "shown") continue;
    const later = statements.slice(at + 1);
    const status =
      liveStatusOf(statements[at], later, args) ??
      (await unfilledStatusOf(filled[at], later, args));
    if (status !== undefined) proofs[at] = { ...proof, status };
  }
  return proofs;
}

/** What `proveStatements` is given, as its parts read it. */
type ProofArgs = Parameters<typeof proveStatements>[0];

/**
 * The status the live schema gives a statement the snapshot shows, where it is not `shown`: a
 * constraint or a key the database does not hold as the statement leaves it, or a restated column
 * that keeps a setting or cannot be read.
 */
function liveStatusOf(
  statement: string,
  later: readonly string[],
  { dialect, sides, live }: ProofArgs
): StatementProof["status"] | undefined {
  if (
    !inlineConstraintsUsable(statement, dialect, sides, live.schema) ||
    !generatedKeysAssigned(statement, later, dialect, live.schema) ||
    !namedObjectsStand(statement, later, dialect, live.schema) ||
    !carriedCounterCovers(statement, later, dialect, live.schema)
  ) {
    return "not-done";
  }
  const restated = restatedColumnsStand(statement, later, dialect, live.schema);
  return restated === "as-left" ? undefined : restated;
}

/**
 * `unfilled` where a column the statement fills with its default still holds NULL in some row,
 * counted where the rest of the file leaves the column; one it drops has no rows to count.
 */
async function unfilledStatusOf(
  filled: readonly FilledColumn[],
  later: readonly string[],
  { dialect, live }: ProofArgs
): Promise<"unfilled" | undefined> {
  for (const column of filled) {
    const end = whereItEnds(column, later, dialect, "rows");
    if (end === undefined) continue;
    if ((await live.nullsIn(end.table, end.column)) > 0) return "unfilled";
  }
  return undefined;
}

/**
 * Whether the foreign keys and checks a `CREATE TABLE` declares in its body, as the target snapshot
 * records them, are ones the live database can use: on PostgreSQL a constraint added `NOT VALID`
 * is there but unvalidated, which the snapshot comparison cannot see (`LiveSchema.usable`). True
 * for any other statement.
 */
function inlineConstraintsUsable(
  statement: string,
  dialect: SupportedDialect,
  sides: { target: NextlySchemaSnapshot },
  schema: LiveSchema
): boolean {
  const name = createdTable(statement, dialect);
  const table = sides.target.tables.find(
    each => each.name.toLowerCase() === name
  );
  if (table === undefined) return true;
  return [...(table.foreignKeys ?? []), ...(table.checks ?? [])].every(
    constraint =>
      schema.usable({
        kind: "constraint",
        table: table.name,
        name: constraint.name,
      })
  );
}

/** PostgreSQL's types that create a sequence the column owns and default to it. */
const SERIAL_TYPES = new Set([
  "SERIAL",
  "BIGSERIAL",
  "SMALLSERIAL",
  "SERIAL2",
  "SERIAL4",
  "SERIAL8",
]);

/** The tokens of a definition outside any parentheses: what it declares, not what it names. */
function outsideParentheses(
  tokens: readonly StatementToken[]
): StatementToken[] {
  let depth = 0;
  return tokens.filter(token => {
    if (token === "(") depth += 1;
    const outside = depth === 0;
    if (token === ")") depth = Math.max(0, depth - 1);
    return outside;
  });
}

/** Whether `words` come next to each other, in order, somewhere in `tokens`. */
function hasRun(
  tokens: readonly StatementToken[],
  ...words: readonly string[]
): boolean {
  return tokens.some((_token, at) =>
    words.every((word, k) => tokens[at + k] === word)
  );
}

/** A PostgreSQL identity column's mode: whether a written value is refused or taken. */
type IdentityMode = "always" | "by-default";

/** A column a statement has the database assign, with its identity mode where it declares one. */
interface DeclaredKey extends FilledColumn {
  identity?: IdentityMode;
}

/**
 * Whether a column definition's tail has the database assign its value: PostgreSQL's serial types
 * and identity columns (`AS IDENTITY`), MySQL's `AUTO_INCREMENT`, its `SERIAL` type and its
 * `SERIAL DEFAULT VALUE` attribute. Read outside parentheses, so a name inside a check or a
 * reference is not taken for one. SQLite declares none: an `INTEGER PRIMARY KEY` is the rowid
 * whatever else the table says.
 */
function declaresGeneratedKey(
  tail: readonly StatementToken[],
  dialect: SupportedDialect
): boolean {
  if (dialect === "sqlite") return false;
  const declared = outsideParentheses(tail);
  const type = declared[0];
  if (dialect === "mysql") {
    return (
      type === "SERIAL" ||
      declared.includes("AUTO_INCREMENT") ||
      hasRun(declared, "SERIAL", "DEFAULT", "VALUE")
    );
  }
  return (
    (typeof type === "string" && SERIAL_TYPES.has(type)) ||
    hasRun(declared, "AS", "IDENTITY")
  );
}

/** The mode an identity column's definition declares, or undefined for any other column. */
function declaredIdentity(
  tail: readonly StatementToken[]
): IdentityMode | undefined {
  const declared = outsideParentheses(tail);
  if (hasRun(declared, "ALWAYS", "AS", "IDENTITY")) return "always";
  return hasRun(declared, "BY", "DEFAULT", "AS", "IDENTITY")
    ? "by-default"
    : undefined;
}

/**
 * Whether every key the statement has the database assign is one the live table assigns in the
 * way declared (an identity column in its mode, any other key as no identity column): in a table it creates, or in a column it adds to one. The
 * snapshot comparison reads such a key as its storage type, so a table made by hand with a plain
 * integer key stands where the file ends, and every insert that leaves the key out fails there.
 * Each key is asked about where the rest of the file leaves it (`whereItEnds`), so one made on a
 * table the file renames into place is asked about there. True for any other statement.
 */
function generatedKeysAssigned(
  statement: string,
  later: readonly string[],
  dialect: SupportedDialect,
  schema: LiveSchemaWithColumnFacts
): boolean {
  return generatedKeysOf(statement, dialect).every(key => {
    const end = whereItEnds(key, later, dialect, "key");
    if (end === undefined) return true;
    return (
      schema.generatesKey(end.table, end.column) &&
      // The mode declared, or none: a serial key or an AUTO_INCREMENT one is no identity column,
      // which refuses or takes a written value by its own rule.
      schema.identityMode(end.table, end.column) === key.identity
    );
  });
}

/** The columns a statement declares with a key the database assigns (`declaresGeneratedKey`). */
function generatedKeysOf(
  statement: string,
  dialect: SupportedDialect
): DeclaredKey[] {
  const table = createdTable(statement, dialect);
  const declared: Array<[string, string, StatementToken[]]> =
    table === undefined
      ? columnsAdded(statement, dialect)
      : columnDefinitions(statement, dialect).map(([column, tail]) => [
          table,
          column,
          tail,
        ]);
  return declared
    .filter(([, , tail]) => declaresGeneratedKey(tail, dialect))
    .map(([on, column, tail]) => ({
      table: on,
      column,
      identity: declaredIdentity(tail),
    }));
}

/**
 * One thing a statement does to where a column stands: its table renamed or dropped, or the
 * column itself renamed, dropped or settled again.
 */
type NameStep =
  | { table: string; column?: undefined; to: string | undefined }
  | {
      table: string;
      column: string;
      /** The column's name afterwards, where the step renames it. */
      to?: string;
      /**
       * What the step ends: `dropped`, every question about the column; `restated`, what a MySQL
       * restatement settles again and asks for itself (its settings, its key); `plain`, the key
       * the database assigned it.
       */
      ends?: "dropped" | "restated" | "plain";
    };

/** What `ALTER [COLUMN] c` goes on to say where it takes the key the database assigns away. */
const KEY_CHANGES: readonly (readonly string[])[] = [
  ["DROP", "DEFAULT"],
  ["SET", "DEFAULT"],
  ["DROP", "IDENTITY"],
  ["SET", "GENERATED"],
  ["ADD", "GENERATED"],
];

/**
 * Every step one statement takes, in the order it takes them: each pair of a table rename
 * (`tableRenamesOf`, MySQL's `RENAME TABLE a TO b, b TO c` included), each table dropped, and
 * within an `ALTER TABLE` each clause that renames, drops or settles a column again.
 */
function nameStepsOf(statement: string, dialect: SupportedDialect): NameStep[] {
  const renames = tableRenamesOf(cursorOf(statement, dialect, EXACT), dialect);
  if (renames !== undefined) {
    return renames.map(([table, to]) => ({ table, to }));
  }
  const dropped = droppedBy(statement, dialect);
  if (dropped.length > 0) {
    return dropped.map(table => ({ table, to: undefined }));
  }
  const altered = alteredTableOf(statement, dialect);
  if (altered === undefined) return [];
  return altered.clauses.flatMap(clause =>
    columnStepOf(clause, altered.table, dialect)
  );
}

/**
 * The table an `ALTER TABLE [IF EXISTS] [ONLY] t ...` alters and each of its clauses, ready to
 * read; undefined for any other statement. The one reading of that opening.
 */
function alteredTableOf(
  statement: string,
  dialect: SupportedDialect
): { table: string; clauses: StatementCursor[] } | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("ALTER", "TABLE")) return undefined;
  cursor.acceptCondition();
  if (dialect === "postgresql") cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined) return undefined;
  return {
    table,
    clauses: cursor.clauses().map(tokens => new StatementCursor(tokens)),
  };
}

/** The words an `ALTER TABLE` clause that may move or settle a column opens with. */
const COLUMN_STEP_VERBS = ["DROP", "RENAME", "CHANGE", "MODIFY", "ALTER"];

/** The step one `ALTER TABLE` clause takes on a column of `table`, where it takes one. */
function columnStepOf(
  clause: StatementCursor,
  table: string,
  dialect: SupportedDialect
): NameStep[] {
  const verb = COLUMN_STEP_VERBS.find(word => clause.accept(word));
  if (verb === undefined) return [];
  // A constraint, index or key dropped or renamed is not a column.
  if (!clause.accept("COLUMN") && addsAnotherElement(clause, dialect)) {
    return [];
  }
  clause.acceptCondition();
  const column = clause.name();
  if (column === undefined) return [];
  const step = stepAfter(verb, clause, column, dialect);
  return step === undefined ? [] : [{ table, column, ...step }];
}

/** What a clause does to the column it names, read after the column: its new name, what it ends. */
function stepAfter(
  verb: string,
  clause: StatementCursor,
  column: string,
  dialect: SupportedDialect
): { to?: string; ends?: "dropped" | "restated" | "plain" } | undefined {
  if (verb === "DROP") return { ends: "dropped" };
  if (verb === "RENAME") {
    clause.accept("TO");
    const to = clause.name();
    return to === undefined ? undefined : { to };
  }
  if (verb === "ALTER") {
    const plain =
      dialect === "postgresql" &&
      KEY_CHANGES.some(words => clause.accept(...words));
    return plain ? { ends: "plain" } : undefined;
  }
  if (dialect !== "mysql") return undefined;
  const to = verb === "CHANGE" ? clause.name() : column;
  return to === undefined ? undefined : { to, ends: "restated" };
}

/** A question the proof asks of a column: each is ended by different later statements. */
type ColumnQuestion = "key" | "settings" | "rows";

/** Whether a step that ends something ends this question (see `NameStep.ends`). */
function endsQuestion(
  ends: "dropped" | "restated" | "plain" | undefined,
  asking: ColumnQuestion
): boolean {
  if (ends === "dropped") return true;
  if (ends === "restated") return asking !== "rows";
  return ends === "plain" && asking === "key";
}

/**
 * Where a column stands after one step, or undefined where the step ends the question: a step on
 * another table or column leaves it where it was.
 */
function afterStep(
  at: FilledColumn,
  step: NameStep,
  asking: ColumnQuestion
): FilledColumn | undefined {
  if (step.table !== at.table) return at;
  if (step.column === undefined) {
    return step.to === undefined ? undefined : { ...at, table: step.to };
  }
  if (step.column !== at.column) return at;
  if (endsQuestion(step.ends, asking)) return undefined;
  return { ...at, column: step.to ?? at.column };
}

/**
 * Where a column stands once the later statements of the file have run, for one question about
 * it: followed, step by step and in order, through every rename of it and of its table
 * (`nameStepsOf`), or undefined where a later statement ends the question. A drop ends them all.
 * A MySQL restatement ends the questions it settles again and asks for itself, the column's
 * settings and its key, and for its rows is a rename. A statement that makes the column plain
 * ends the question of its key. The one routine for every question the proof asks of a column.
 */
function whereItEnds(
  start: FilledColumn,
  later: readonly string[],
  dialect: SupportedDialect,
  asking: ColumnQuestion
): FilledColumn | undefined {
  let at: FilledColumn | undefined = {
    table: start.table.toLowerCase(),
    column: start.column.toLowerCase(),
  };
  for (const step of later.flatMap(each => nameStepsOf(each, dialect))) {
    at = afterStep(at, step, asking);
    if (at === undefined) return undefined;
  }
  return at;
}

/**
 * The columns a MySQL `ALTER TABLE` restates, each under the name the statement leaves it with:
 * `MODIFY [COLUMN] c ...` and `CHANGE [COLUMN] a b ...`. None on another dialect.
 */
function restatedColumns(
  statement: string,
  dialect: SupportedDialect
): FilledColumn[] {
  const altered = dialect === "mysql" && alteredTableOf(statement, dialect);
  if (altered === false || altered === undefined) return [];
  const { table } = altered;
  return altered.clauses.flatMap(clause => {
    const renames = clause.accept("CHANGE");
    if (!renames && !clause.accept("MODIFY")) return [];
    clause.accept("COLUMN");
    clause.acceptCondition();
    const named = clause.name();
    const column = renames ? clause.name() : named;
    return column === undefined ? [] : [{ table, column }];
  });
}

/**
 * How the columns a statement restates stand in the live database, each asked about where the
 * rest of the file leaves it (`whereItEnds`): `keeps` where one holds a setting the statement
 * would put back (the file was not run, so the column still has it, and a database the file did
 * run on does not); `unshown` where one is on a table whose column settings cannot all be read
 * (`LiveColumnFacts.settingsReadable`), so nothing shows what it holds; `as-left` otherwise, and
 * for any other statement.
 */
function restatedColumnsStand(
  statement: string,
  later: readonly string[],
  dialect: SupportedDialect,
  schema: LiveSchemaWithColumnFacts
): "as-left" | "keeps" | "unshown" {
  const ends = restatedColumns(statement, dialect).flatMap(
    restated => whereItEnds(restated, later, dialect, "settings") ?? []
  );
  if (ends.some(end => !schema.settingsReadable(end.table))) return "unshown";
  return ends.some(
    end => schema.untrackedSettings(end.table, end.column).length > 0
  )
    ? "keeps"
    : "as-left";
}

/**
 * For each statement, the nullable columns it fills with a default in every row its table holds:
 * `ALTER TABLE ... ADD [COLUMN] c ... DEFAULT <value>`, and a SQLite rebuild's copy, for each
 * column of the twin it leaves to its default (`ownRowsCopy`). A NOT NULL column holds no NULL to
 * find, so it is not counted.
 */
function columnsFilledBy(
  statements: readonly string[],
  dialect: SupportedDialect
): FilledColumn[][] {
  return statements.map(statement => {
    const copy = ownRowsCopy(statement, dialect);
    if (copy === undefined) return columnsAddedWithDefault(statement, dialect);
    const create = statements.find(
      other => createdTable(other, dialect) === copy.twin
    );
    return create === undefined
      ? []
      : twinColumnsLeftToDefault(create, copy, dialect);
  });
}

/** The columns of a rebuild's twin with a default that its copy leaves out: filled by it. */
function twinColumnsLeftToDefault(
  create: string,
  copy: { twin: string; columns: string[] },
  dialect: SupportedDialect
): FilledColumn[] {
  // Under the twin's own name: the rename that moves it into place is followed like any other.
  const table = copy.twin;
  return columnDefinitions(create, dialect)
    .filter(
      ([column, tail]) =>
        !copy.columns.includes(column) && fillsWithDefault(tail)
    )
    .map(([column]) => ({ table, column }));
}

/**
 * The table a `CREATE TABLE [IF NOT EXISTS] t (...)` creates and each clause of its body, ready
 * to read; undefined for any other statement. The one reading of that body.
 */
function createdBodyOf(
  create: string,
  dialect: SupportedDialect
): { table: string; clauses: StatementCursor[] } | undefined {
  const cursor = cursorOf(create, dialect, EXACT);
  if (!cursor.accept("CREATE", "TABLE")) return undefined;
  cursor.acceptCondition();
  const table = cursor.name();
  if (table === undefined || !cursor.accept("(")) return undefined;
  const body = cursor.rest();
  return {
    table,
    clauses: new StatementCursor(body.slice(0, body.lastIndexOf(")")))
      .clauses()
      .map(tokens => new StatementCursor(tokens)),
  };
}

/** Each column a `CREATE TABLE` body defines, with the tokens after its name. */
function columnDefinitions(
  create: string,
  dialect: SupportedDialect
): Array<[string, StatementToken[]]> {
  return (createdBodyOf(create, dialect)?.clauses ?? []).flatMap(definition => {
    if (nextIn(definition, TABLE_CONSTRAINT_WORDS)) return [];
    const column = definition.name();
    return column === undefined ? [] : [[column, definition.rest()]];
  });
}

/**
 * A constraint or index a statement makes or validates under a name, with the tokens after the
 * name: what the live database can hold another way under that same name.
 */
interface NamedObject {
  kind: "constraint" | "validated" | "index";
  table: string;
  name: string;
  tail: StatementToken[];
}

/** `CONSTRAINT n ...`, read after `CONSTRAINT`, as a named constraint of `table`. */
function namedConstraint(
  clause: StatementCursor,
  table: string
): NamedObject[] {
  const name = clause.name();
  return name === undefined
    ? []
    : [{ kind: "constraint", table, name, tail: clause.rest() }];
}

/** The named object one `ALTER TABLE` clause makes or validates, where it does. */
function namedObjectOfClause(
  clause: StatementCursor,
  table: string,
  dialect: SupportedDialect
): NamedObject[] {
  if (clause.accept("VALIDATE", "CONSTRAINT")) {
    const name = clause.name();
    return name === undefined
      ? []
      : [{ kind: "validated", table, name, tail: [] }];
  }
  if (!clause.accept("ADD")) return [];
  if (clause.accept("CONSTRAINT")) return namedConstraint(clause, table);
  if (dialect !== "mysql") return [];
  clause.accept("UNIQUE");
  if (!clause.accept("INDEX") && !clause.accept("KEY")) return [];
  const name = clause.name();
  return name === undefined
    ? []
    : [{ kind: "index", table, name, tail: clause.rest() }];
}

/** The index a `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] n ON [ONLY] t` creates. */
function createdIndexOf(
  statement: string,
  dialect: SupportedDialect
): NamedObject[] {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("CREATE")) return [];
  cursor.accept("UNIQUE");
  if (!cursor.accept("INDEX")) return [];
  if (dialect === "postgresql") cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined || !cursor.accept("ON")) return [];
  if (dialect === "postgresql") cursor.accept("ONLY");
  const table = cursor.name();
  return table === undefined
    ? []
    : [{ kind: "index", table, name, tail: cursor.rest() }];
}

/** Every constraint and index a statement makes or validates under a name. */
function namedObjectsOf(
  statement: string,
  dialect: SupportedDialect
): NamedObject[] {
  const created = createdBodyOf(statement, dialect);
  if (created !== undefined) {
    return created.clauses.flatMap(clause =>
      clause.accept("CONSTRAINT") ? namedConstraint(clause, created.table) : []
    );
  }
  const altered = alteredTableOf(statement, dialect);
  if (altered !== undefined) {
    return altered.clauses.flatMap(clause =>
      namedObjectOfClause(clause, altered.table, dialect)
    );
  }
  return createdIndexOf(statement, dialect);
}

/** Words after `DROP` in an `ALTER TABLE` clause that open a named constraint, index or key. */
const DROPPED_BY_NAME: readonly (readonly string[])[] = [
  ["CONSTRAINT"],
  ["CHECK"],
  ["FOREIGN", "KEY"],
  ["INDEX"],
  ["KEY"],
];

/** The names of the constraints and indexes one statement drops, lower-cased. */
function namesDroppedBy(
  statement: string,
  dialect: SupportedDialect
): string[] {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (cursor.accept("DROP", "INDEX")) {
    if (dialect === "postgresql") cursor.accept("CONCURRENTLY");
    cursor.acceptCondition();
    return cursor.names() ?? [];
  }
  return (alteredTableOf(statement, dialect)?.clauses ?? []).flatMap(clause => {
    if (!clause.accept("DROP")) return [];
    if (!DROPPED_BY_NAME.some(words => clause.accept(...words))) return [];
    clause.acceptCondition();
    const name = clause.name();
    return name === undefined ? [] : [name];
  });
}

/**
 * The table a named object is on once the later statements of the file have run, or undefined
 * where one of them drops the object or its table: nothing is asked of it then.
 */
function whereObjectEnds(
  object: NamedObject,
  later: readonly string[],
  dialect: SupportedDialect
): string | undefined {
  const dropped = later.some(statement =>
    namesDroppedBy(statement, dialect).includes(object.name)
  );
  if (dropped) return undefined;
  // A table is followed as its columns are: no step names the column of no name.
  return whereItEnds(
    { table: object.table, column: "" },
    later,
    dialect,
    "rows"
  )?.table;
}

/** How a foreign key's definition has its check deferred: PostgreSQL's three states. */
function declaredDeferrability(
  tail: readonly StatementToken[]
): "not" | "immediate" | "deferred" {
  const declared = outsideParentheses(tail);
  if (hasRun(declared, "NOT", "DEFERRABLE")) return "not";
  if (!declared.includes("DEFERRABLE")) return "not";
  return hasRun(declared, "INITIALLY", "DEFERRED") ? "deferred" : "immediate";
}

/**
 * Whether one named constraint stands in the live database as its definition declares, in what
 * the snapshot does not record of it: a MySQL check enforced or not, a PostgreSQL foreign key's
 * deferrability. True for any other constraint.
 */
function constraintAsDeclared(
  object: NamedObject,
  table: string,
  dialect: SupportedDialect,
  schema: LiveSchemaWithColumnFacts
): boolean {
  const declared = outsideParentheses(object.tail);
  if (dialect === "mysql" && declared[0] === "CHECK") {
    return (
      schema.checkEnforced(table, object.name) ===
      !hasRun(declared, "NOT", "ENFORCED")
    );
  }
  if (dialect === "postgresql" && declared[0] === "FOREIGN") {
    return (
      schema.keyDeferrability(table, object.name) ===
      declaredDeferrability(object.tail)
    );
  }
  return true;
}

/**
 * Whether every constraint and index the statement makes or validates under a name stands in the
 * live database as the statement leaves it. The snapshot comparison finds the name and the
 * columns; a database brought there by hand can hold under that name a constraint never
 * validated, a check not enforced, a deferrable key, or an index in another order or by another
 * method. Each is asked about on the table the rest of the file leaves it on, and not at all
 * where a later statement drops it.
 */
function namedObjectsStand(
  statement: string,
  later: readonly string[],
  dialect: SupportedDialect,
  schema: LiveSchemaWithColumnFacts
): boolean {
  return namedObjectsOf(statement, dialect).every(object => {
    const table = whereObjectEnds(object, later, dialect);
    if (table === undefined) return true;
    if (object.kind === "validated") {
      return schema.usable({ kind: "constraint", table, name: object.name });
    }
    if (object.kind === "index") {
      return schema.indexShape(object.name, table) === "plain";
    }
    return constraintAsDeclared(object, table, dialect, schema);
  });
}

/** The twin a SQLite rebuild's sequence carry names, read from its fixed text (`isSequenceCarry`). */
const SEQUENCE_CARRY =
  /^INSERT INTO sqlite_sequence \(name, seq\) SELECT '((?:[^']|'')+)', seq FROM sqlite_sequence WHERE name = '/;

/**
 * Whether the counter a SQLite rebuild carries covers its table's rows in the live database
 * (`LiveColumnFacts.counterCovers`), asked of the table the twin is moved into place as. The
 * carry itself leaves nothing to compare: the value it copied is gone with the table it copied
 * from. True for any other statement.
 */
function carriedCounterCovers(
  statement: string,
  later: readonly string[],
  dialect: SupportedDialect,
  schema: LiveSchemaWithColumnFacts
): boolean {
  const twin =
    dialect === "sqlite"
      ? SEQUENCE_CARRY.exec(statement.trim())?.[1]
      : undefined;
  if (twin === undefined) return true;
  const end = whereItEnds(
    { table: twin.replace(/''/g, "'"), column: "" },
    later,
    dialect,
    "rows"
  );
  return end === undefined || schema.counterCovers(end.table);
}

/** Words opening a table constraint in a `CREATE TABLE` body, not a column. */
const TABLE_CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "UNIQUE",
  "FOREIGN",
  "CHECK",
]);

/** `ALTER TABLE t ADD [COLUMN] [IF NOT EXISTS] c ... DEFAULT <value>` clauses, nullable ones. */
function columnsAddedWithDefault(
  statement: string,
  dialect: SupportedDialect
): FilledColumn[] {
  return columnsAdded(statement, dialect)
    .filter(([, , tail]) => fillsWithDefault(tail))
    .map(([table, column]) => ({ table, column }));
}

/**
 * Each column an `ALTER TABLE t ADD [COLUMN] [IF NOT EXISTS] c ...` adds: its table, its name and
 * the tokens after its name. None for any other statement.
 */
function columnsAdded(
  statement: string,
  dialect: SupportedDialect
): Array<[string, string, StatementToken[]]> {
  const altered = alteredTableOf(statement, dialect);
  if (altered === undefined) return [];
  const { table } = altered;
  return altered.clauses.flatMap(clause => {
    if (!clause.accept("ADD")) return [];
    // A constraint, index or key added is not a column, whatever it is named.
    if (!clause.accept("COLUMN") && addsAnotherElement(clause, dialect)) {
      return [];
    }
    clause.acceptCondition();
    const column = clause.name();
    return column === undefined ? [] : [[table, column, clause.rest()]];
  });
}

/** Whether what follows `ADD` is a constraint, index, key or anything else that is not a column. */
function addsAnotherElement(
  clause: StatementCursor,
  dialect: SupportedDialect
): boolean {
  const next = clause.peek();
  return (
    typeof next === "string" &&
    (elementWord(next, dialect) || NOT_A_COLUMN.has(next))
  );
}

/**
 * Whether a column definition's tail gives it a default other than NULL while leaving it nullable:
 * the rows it fills could have been left NULL by another way to the same schema.
 */
function fillsWithDefault(tail: readonly StatementToken[]): boolean {
  const at = tail.indexOf("DEFAULT");
  if (at === -1 || tail[at + 1] === "NULL") return false;
  const notNull = tail.some(
    (token, i) => token === "NOT" && tail[i + 1] === "NULL"
  );
  return !notNull && !tail.includes("PRIMARY");
}

/** Verdicts of the live database that say a statement's effect is not there (`judgeStatements`). */
function liveDisagrees(judged: JudgedStatement | undefined): boolean {
  if (judged === undefined) return false;
  if (judged.verdict === "not_done") return true;
  return judged.reason === "mixed" || judged.reason === "no_table";
}

/** The names a file's two snapshot sides record, lower-cased. */
interface SnapshotObjects {
  tables: ReadonlySet<string>;
  indexes: ReadonlySet<string>;
}

function objectsOf(sides: readonly NextlySchemaSnapshot[]): SnapshotObjects {
  const tables = new Set<string>();
  const indexes = new Set<string>();
  for (const table of sides.flatMap(side => side.tables)) {
    tables.add(table.name.toLowerCase());
    for (const index of table.indexes ?? []) {
      indexes.add(index.name.toLowerCase());
    }
  }
  return { tables, indexes };
}

/**
 * Quoted names are read only as written in lower case: PostgreSQL keeps a quoted name's case, so
 * `"Posts"` is not the snapshot's `posts`, and a name in another case fails closed.
 */
const EXACT = { exactQuotedNames: true } as const;

/** Session settings that last no longer than the run and change no object. */
const SESSION_SETTINGS = new Set([
  "LOCK_TIMEOUT",
  "STATEMENT_TIMEOUT",
  "IDLE_IN_TRANSACTION_SESSION_TIMEOUT",
  "FOREIGN_KEY_CHECKS",
  "UNIQUE_CHECKS",
  "LOCK_WAIT_TIMEOUT",
  "INNODB_LOCK_WAIT_TIMEOUT",
]);

/** The SQLite pragmas a table rebuild uses, none of which outlives the connection's run. */
const REBUILD_PRAGMAS = new Set([
  "FOREIGN_KEYS",
  "FOREIGN_KEY_CHECK",
  "DEFER_FOREIGN_KEYS",
  "LEGACY_ALTER_TABLE",
]);

/** Words after `ADD` or `DROP` in an `ALTER TABLE` clause that name what follows. */
const ELEMENT_WORDS = new Set([
  "COLUMN",
  "CONSTRAINT",
  "UNIQUE",
  "PRIMARY",
  "FOREIGN",
  "CHECK",
]);
/** MySQL's further element words after `ADD` or `DROP`. */
const MYSQL_ELEMENT_WORDS = new Set(["INDEX", "KEY"]);

/** What `ALTER [COLUMN] c` may go on to change: what the snapshot records of a column. */
const COLUMN_CHANGES: readonly (readonly string[])[] = [
  ["TYPE"],
  ["SET", "DATA", "TYPE"],
  ["SET", "NOT", "NULL"],
  ["DROP", "NOT", "NULL"],
  ["SET", "DEFAULT"],
  ["DROP", "DEFAULT"],
];

/** What one statement's reading needs to know of the file around it. */
interface FileContext {
  dialect: SupportedDialect;
  objects: SnapshotObjects;
  /** Tables an earlier statement of the file created. */
  created: ReadonlySet<string>;
  /** Tables a later statement drops, or renames into a table the snapshot holds. */
  goneLater: ReadonlySet<string>;
  /** Tables a later statement drops: gone by the end, with any rows written into them. */
  droppedLater: ReadonlySet<string>;
}

/** A table the statement may change: the snapshot holds it, or the file itself created it. */
function known(table: string | undefined, file: FileContext): boolean {
  return (
    table !== undefined &&
    (file.objects.tables.has(table) || file.created.has(table))
  );
}

/**
 * Each statement of a pending file, labelled, with whether the snapshot shows what it does. The
 * snapshot's two sides are the ones the file was written between, whole (not narrowed to what
 * the app contributes), so a table either holds is one the comparison read.
 */
export function statementsShownBySnapshot(
  statements: readonly string[],
  dialect: SupportedDialect,
  sides: { before: NextlySchemaSnapshot; target: NextlySchemaSnapshot },
  /**
   * The same statements judged against the live database (`judgeStatements`): a schema statement
   * the snapshot shows is still not proven where the database does not stand as it leaves it,
   * which the snapshot comparison cannot see (an index left invalid, a constraint not validated).
   */
  judged: readonly JudgedStatement[] = []
): StatementProof[] {
  const objects = objectsOf([sides.before, sides.target]);
  const shown = statements.map(() => false);
  const runs = mysqlRunsAt(statements, dialect, objects);
  const copies = rebuildCopyStatements(statements, dialect);
  const goneAfter = tablesAfter(statements, statement =>
    goneBy(statement, dialect, objects.tables)
  );
  const droppedAfter = tablesAfter(statements, statement =>
    droppedBy(statement, dialect)
  );
  const created = new Set<string>();
  statements.forEach((statement, at) => {
    const file: FileContext = {
      dialect,
      objects,
      created,
      goneLater: goneAfter[at],
      droppedLater: droppedAfter[at],
    };
    shown[at] =
      runs.has(at) ||
      copies.has(at) ||
      isSequenceCarry(statement, statements, dialect, objects) ||
      isOwnRegistryRow(statement, dialect, objects) ||
      isVersionAfterOwnRegistryRows(statement, statements.slice(0, at), {
        dialect,
        objects,
      }) ||
      statementShown(statement, file);
    const made = createdTable(statement, dialect);
    if (made !== undefined) created.add(made);
  });
  return statements.map((statement, at) => ({
    label: labelOf(statement, dialect),
    status: !shown[at]
      ? "unshown"
      : liveDisagrees(judged[at])
        ? "not-done"
        : "shown",
  }));
}

/** The positions of MySQL's generated four-statement runs on a table the snapshot holds. */
function mysqlRunsAt(
  statements: readonly string[],
  dialect: SupportedDialect,
  objects: SnapshotObjects
): ReadonlySet<number> {
  const positions = new Set<number>();
  if (dialect !== "mysql") return positions;
  for (let at = 0; at < statements.length; at += 1) {
    const run = mysqlLiveRunAt(statements, at);
    if (run === undefined || !objects.tables.has(run.tableName.toLowerCase())) {
      continue;
    }
    for (let k = 0; k < MYSQL_LIVE_RUN_LENGTH; k += 1) positions.add(at + k);
    at += MYSQL_LIVE_RUN_LENGTH - 1;
  }
  return positions;
}

/** For each statement, the tables `read` names in the statements after it. */
function tablesAfter(
  statements: readonly string[],
  read: (statement: string) => string[]
): ReadonlySet<string>[] {
  const after: ReadonlySet<string>[] = [];
  let later = new Set<string>();
  for (let at = statements.length - 1; at >= 0; at -= 1) {
    after[at] = later;
    later = new Set([...later, ...read(statements[at])]);
  }
  return after;
}

/** The tables one statement drops, or renames into a table the snapshot holds. */
function goneBy(
  statement: string,
  dialect: SupportedDialect,
  tables: ReadonlySet<string>
): string[] {
  const dropped = droppedBy(statement, dialect);
  if (dropped.length > 0) return dropped;
  const renames = tableRenamesOf(cursorOf(statement, dialect, EXACT), dialect);
  if (renames === undefined) return [];
  return renames.filter(([, to]) => tables.has(to)).map(([from]) => from);
}

/** The tables a `DROP TABLE` drops; none for any other statement. */
function droppedBy(statement: string, dialect: SupportedDialect): string[] {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("DROP", "TABLE")) return [];
  cursor.acceptCondition();
  return cursor.names() ?? [];
}

/**
 * The tables a statement renames, as `[from, to]` pairs: `ALTER TABLE [IF EXISTS] [ONLY] a RENAME
 * TO|AS b`, or MySQL's `RENAME TABLE a TO b[, c TO d]`. Undefined for any other statement, or one
 * that does more. The one reading of a rename, for what is gone and for what is shown.
 */
function tableRenamesOf(
  cursor: StatementCursor,
  dialect: SupportedDialect
): Array<[string, string]> | undefined {
  if (dialect === "mysql" && cursor.accept("RENAME", "TABLE")) {
    return renamePairs(cursor);
  }
  if (!cursor.accept("ALTER", "TABLE")) return undefined;
  cursor.acceptCondition();
  if (dialect === "postgresql") cursor.accept("ONLY");
  const pair = alterTableRename(cursor);
  return pair === undefined ? undefined : [pair];
}

/** After `ALTER TABLE`'s prefix: `a RENAME TO|AS b`, as the whole statement, or undefined. */
function alterTableRename(
  cursor: StatementCursor
): [string, string] | undefined {
  const from = cursor.name();
  if (from === undefined || !cursor.accept("RENAME")) return undefined;
  if (!cursor.accept("TO")) cursor.accept("AS");
  const to = cursor.name();
  return to !== undefined && cursor.done() ? [from, to] : undefined;
}

/** `a TO b[, c TO d]`, the whole rest of the statement, or undefined. */
function renamePairs(
  cursor: StatementCursor
): Array<[string, string]> | undefined {
  const pairs: Array<[string, string]> = [];
  do {
    const from = cursor.name();
    if (from === undefined || !cursor.accept("TO")) return undefined;
    const to = cursor.name();
    if (to === undefined) return undefined;
    pairs.push([from, to]);
  } while (cursor.accept(","));
  return cursor.done() ? pairs : undefined;
}

/** The table a `CREATE TABLE` creates, or undefined for any other statement. */
function createdTable(
  statement: string,
  dialect: SupportedDialect
): string | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("CREATE", "TABLE")) return undefined;
  cursor.acceptCondition();
  return cursor.name();
}

/**
 * A SQLite rebuild's carry of a table's AUTOINCREMENT sequence to its twin, exactly as the rebuild
 * writes it (`sqliteSwapStatements`), for a table the file rebuilds and the snapshot holds.
 */
function isSequenceCarry(
  statement: string,
  statements: readonly string[],
  dialect: SupportedDialect,
  objects: SnapshotObjects
): boolean {
  if (dialect !== "sqlite") return false;
  return [...objects.tables].some(table => {
    const twin = `__new_${table}`;
    const carry =
      `INSERT INTO sqlite_sequence (name, seq) SELECT ${literalOf(twin)}, seq ` +
      `FROM sqlite_sequence WHERE name = ${literalOf(table)}`;
    return (
      statement.trim().replace(/;$/, "") === carry &&
      statements.some(other => createdTable(other, dialect) === twin)
    );
  });
}

/** A registry row `migrate:create` writes, for an entity whose table the snapshot holds. */
function isOwnRegistryRow(
  statement: string,
  dialect: SupportedDialect,
  objects: SnapshotObjects
): boolean {
  const row = registryRowWrittenBy(statement, dialect);
  if (row === undefined) return false;
  const keys = registryRowKeys(row.table, row.slug);
  return keys !== undefined && objects.tables.has(keys.table_name);
}

/**
 * The statement `migrate:create` writes after a file's registry rows, moving the stored schema
 * version (`schemaVersionStoreSql`): that statement text for text, after a registry row of the
 * file the snapshot shows. `nextly migrate` moves the stored version itself once it has written
 * the registry rows of a file it records, so nothing of it is skipped. The same write anywhere
 * else is a row the snapshot does not show.
 */
function isVersionAfterOwnRegistryRows(
  statement: string,
  earlier: readonly string[],
  file: Pick<FileContext, "dialect" | "objects">
): boolean {
  const asWritten = (text: string) => text.trim().replace(/;$/, "");
  return (
    asWritten(statement) === asWritten(schemaVersionStoreSql(file.dialect)) &&
    earlier.some(other => isOwnRegistryRow(other, file.dialect, file.objects))
  );
}

/** One kind of statement on the closed list: its leading words, and how the rest is judged. */
type StatementReader = readonly [
  readonly string[],
  (cursor: StatementCursor, file: FileContext, statement: string) => boolean,
];

/** The statements on the closed list, by their leading words, longest first where two share some. */
const STATEMENT_READERS: readonly StatementReader[] = [
  [["CREATE", "TABLE"], createTableShown],
  [["CREATE", "UNIQUE", "INDEX"], createIndexShown],
  [["CREATE", "INDEX"], createIndexShown],
  [["DROP", "TABLE"], dropTablesShown],
  [["DROP", "INDEX"], dropIndexShown],
  [["INSERT", "INTO"], guardRowsShown],
];

/** Whether one statement, read alone, is on the closed list (see the module comment). */
function statementShown(statement: string, file: FileContext): boolean {
  const renames = tableRenamesOf(
    cursorOf(statement, file.dialect, EXACT),
    file.dialect
  );
  if (renames !== undefined)
    return renames.every(pair => renameShown(pair, file));
  const cursor = cursorOf(statement, file.dialect, EXACT);
  const reader = STATEMENT_READERS.find(([words]) => cursor.accept(...words));
  if (reader !== undefined) return reader[1](cursor, file, statement);
  if (cursor.accept("ALTER", "TABLE")) return alterTableShown(cursor, file);
  return isSessionSetting(cursor, file.dialect);
}

/** A table renamed from one the file may change into one the snapshot holds, or scaffolding. */
function renameShown([from, to]: [string, string], file: FileContext): boolean {
  return (
    known(from, file) && (file.objects.tables.has(to) || file.goneLater.has(to))
  );
}

/**
 * `CREATE TABLE [IF NOT EXISTS] t ...` creating its table empty (`createsEmptyTable`), of a table
 * the snapshot holds or scaffolding the file removes or moves into place again.
 */
function createTableShown(
  cursor: StatementCursor,
  file: FileContext,
  statement: string
): boolean {
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined || !createsEmptyTable(statement, file.dialect)) {
    return false;
  }
  return file.objects.tables.has(name) || file.goneLater.has(name);
}

/** `DROP TABLE [IF EXISTS] a[, b...] [CASCADE|RESTRICT]`, of tables the file may change. */
function dropTablesShown(cursor: StatementCursor, file: FileContext): boolean {
  cursor.acceptCondition();
  const names = cursor.names();
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  return (
    names !== undefined &&
    cursor.done() &&
    names.every(name => known(name, file))
  );
}

/**
 * Rows written into a table the file created: a rebuild's guard, dropped again by the end, or a
 * rebuild's copy of a table's own rows into its twin, moved into place (`ownRowsCopy`). Rows of
 * any other kind put into a table moved into place outlive the file, and are not shown.
 */
function guardRowsShown(
  cursor: StatementCursor,
  file: FileContext,
  statement: string
): boolean {
  const into = cursor.name();
  if (into === undefined || !file.created.has(into)) return false;
  if (file.objects.tables.has(into)) return false;
  if (file.droppedLater.has(into)) return true;
  return (
    file.goneLater.has(into) &&
    ownRowsCopy(statement, file.dialect)?.twin === into
  );
}

/**
 * A rebuild's copy of a table's own rows into its twin: `INSERT INTO __new_t (a, b) SELECT a, b
 * FROM t`, the same columns in both lists. The twin's other columns take their defaults
 * (`columnsFilledBy`).
 */
function ownRowsCopy(
  statement: string,
  dialect: SupportedDialect
): { twin: string; columns: string[] } | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("INSERT", "INTO")) return undefined;
  const twin = cursor.name();
  const columns = sameColumnsCopied(cursor);
  if (twin === undefined || columns === undefined) return undefined;
  if (!cursor.accept("FROM")) return undefined;
  const table = cursor.name();
  return cursor.done() && twin === `__new_${table}`
    ? { twin, columns }
    : undefined;
}

/** `(a, b) SELECT a, b`: the columns, when both lists name the same ones in the same order. */
function sameColumnsCopied(cursor: StatementCursor): string[] | undefined {
  if (!cursor.accept("(")) return undefined;
  const into = cursor.names();
  if (into === undefined || !cursor.accept(")", "SELECT")) return undefined;
  const selected = cursor.names();
  const same =
    selected?.length === into.length &&
    selected.every((column, at) => column === into[at]);
  return same ? into : undefined;
}

/** `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] n ON [ONLY] t ...`. */
function createIndexShown(cursor: StatementCursor, file: FileContext): boolean {
  if (file.dialect === "postgresql") cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  if (cursor.isWord("ON")) return false;
  if (cursor.name() === undefined || !cursor.accept("ON")) return false;
  if (file.dialect === "postgresql") cursor.accept("ONLY");
  return known(cursor.name(), file) && !statesIndexOrder(cursor.rest());
}

/** Words of an index definition that say how its keys are ordered or by what method it is built. */
const INDEX_ORDER_WORDS = new Set(["ASC", "DESC", "NULLS", "USING"]);

/**
 * Whether an index definition states a direction, a NULL order or a method: none is recorded by
 * a snapshot, so a statement that states one changes what no snapshot shows.
 */
function statesIndexOrder(tokens: readonly StatementToken[]): boolean {
  return tokens.some(
    token => typeof token === "string" && INDEX_ORDER_WORDS.has(token)
  );
}

/** `DROP INDEX [CONCURRENTLY] [IF EXISTS] n [ON t] [CASCADE|RESTRICT]`. */
function dropIndexShown(cursor: StatementCursor, file: FileContext): boolean {
  if (file.dialect === "postgresql") cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined) return false;
  // The index must be one the snapshot records, on a table it may change where the drop names one.
  let shown = file.objects.indexes.has(name);
  if (cursor.accept("ON")) shown = shown && known(cursor.name(), file);
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  return shown && cursor.done();
}

/** `ALTER TABLE [IF EXISTS] [ONLY] t <clause>[, <clause>...]`, every clause on the list. */
function alterTableShown(cursor: StatementCursor, file: FileContext): boolean {
  cursor.acceptCondition();
  if (file.dialect === "postgresql") cursor.accept("ONLY");
  const name = cursor.name();
  if (!known(name, file)) return false;
  return cursor
    .clauses()
    .every(tokens => alterClauseShown(new StatementCursor(tokens), file));
}

/** One `ALTER TABLE` clause's reader: whether what it changes is one the snapshot records. */
type ClauseReader = readonly [
  readonly string[],
  (clause: StatementCursor, file: FileContext) => boolean,
];

/**
 * The `ALTER TABLE` clauses on the list, by their leading words. A table rename is not among them:
 * it must be a statement's only clause, and is read as a rename (`tableRenamesOf`).
 */
const CLAUSE_READERS: readonly ClauseReader[] = [
  [["ADD"], (clause, file) => elementFollows(clause, file, true)],
  [["DROP"], (clause, file) => elementFollows(clause, file, false)],
  [["ALTER"], columnChangeShown],
  [["MODIFY"], restatedColumnShown],
  [["CHANGE"], restatedColumnShown],
  [["VALIDATE", "CONSTRAINT"], (_clause, file) => file.dialect !== "mysql"],
  [["RENAME"], elementRenameShown],
];

/** One `ALTER TABLE` clause: what it changes is a column, constraint, index or key. */
function alterClauseShown(clause: StatementCursor, file: FileContext): boolean {
  const reader = CLAUSE_READERS.find(([words]) => clause.accept(...words));
  return reader !== undefined && reader[1](clause, file);
}

/**
 * `ALTER [COLUMN] c` then what the snapshot records of a column: its type (converted by a plain
 * cast of itself, `castsItself`), whether it is nullable, its default.
 */
function columnChangeShown(clause: StatementCursor): boolean {
  clause.accept("COLUMN");
  const column = clause.name();
  if (column === undefined) return false;
  const change = COLUMN_CHANGES.find(words => clause.accept(...words));
  if (change === undefined) return false;
  return change.at(-1) !== "TYPE" || castsItself(clause.rest(), column);
}

/** Whether a token is a word, as a keyword or a bare name is, and not a literal or a symbol. */
const isKeyword = (token: StatementToken | undefined): boolean =>
  typeof token === "string" && /^[A-Z_]/.test(token);

/** Type words that say more than a type: a key the database assigns, or a character set. */
const TYPES_BEYOND_SNAPSHOT = new Set([
  "SERIAL",
  "NATIONAL",
  "NCHAR",
  "NVARCHAR",
]);

/** Words that are part of a type after its name: `double precision`, `bigint unsigned`. */
const TYPE_WORDS = new Set(["PRECISION", "UNSIGNED", "SIGNED", "ZEROFILL"]);

/** What a parenthesised group reads as once it is taken for one token (`groupsAsOne`). */
const GROUP = "()";

/**
 * The tokens with each parenthesised group outside any other taken for one (`GROUP`): a type's
 * size, a function's arguments, an expression. What stands after a group stays where it stood, so
 * an attribute after a default written in parentheses is still read.
 */
function groupsAsOne(tokens: readonly StatementToken[]): StatementToken[] {
  const read: StatementToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token === "(") {
      if (depth === 0) read.push(GROUP);
      depth += 1;
    } else if (token === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      read.push(token);
    }
  }
  return read;
}

/**
 * MySQL's `MODIFY [COLUMN] c ...` and `CHANGE [COLUMN] a b ...`: a column's definition restated,
 * in the one shape `migrate:create` writes, which names only what the snapshot records of a
 * column: `<type> [NULL | NOT NULL] [DEFAULT <value>]`. A clause that states anything else, a
 * position (`FIRST`, `AFTER`) included, changes what no snapshot shows. What the clause leaves out
 * is asked of the live column (`restatedColumnsKeep`).
 */
function restatedColumnShown(
  clause: StatementCursor,
  file: FileContext
): boolean {
  if (file.dialect !== "mysql") return false;
  const renames = clause.peek(-1) === "CHANGE";
  clause.accept("COLUMN");
  clause.acceptCondition();
  if (clause.name() === undefined) return false;
  if (renames && clause.name() === undefined) return false;
  return statesOnlyWhatSnapshotRecords(groupsAsOne(clause.rest()));
}

/**
 * Whether a restated column's definition, each parenthesised group read as one token, is a type
 * followed by nothing but its nullability and its default.
 */
function statesOnlyWhatSnapshotRecords(
  declared: readonly StatementToken[]
): boolean {
  const [type, ...after] = declared;
  if (typeof type !== "string" || TYPES_BEYOND_SNAPSHOT.has(type)) return false;
  const rest = new StatementCursor(after);
  typeTailRead(rest);
  while (!rest.done()) {
    if (rest.accept("NOT", "NULL") || rest.accept("NULL")) continue;
    if (!rest.accept("DEFAULT") || !defaultValueRead(rest)) return false;
  }
  return true;
}

/** Reads past a type's size and the words that belong to it: `decimal(10,2) unsigned`. */
function typeTailRead(rest: StatementCursor): void {
  while (rest.accept(GROUP) || nextIn(rest, TYPE_WORDS)) {
    if (nextIn(rest, TYPE_WORDS)) rest.at += 1;
  }
}

/**
 * Reads a default's value, after `DEFAULT`: one word with any arguments (`NULL`,
 * `CURRENT_TIMESTAMP(3)`), or one literal, signed or not, in as many pieces as the reading gives a
 * number, or an expression in parentheses. False where no value stands there. A word after the
 * value is not part of it, and is left for the caller to refuse.
 */
function defaultValueRead(rest: StatementCursor): boolean {
  if (!rest.accept("-")) rest.accept("+");
  if (rest.done()) return false;
  if (isKeyword(rest.peek())) {
    if (rest.isWord("NOT") || rest.isWord("DEFAULT")) return false;
    rest.at += 1;
    rest.accept(GROUP);
    return true;
  }
  if (rest.accept(GROUP)) return true;
  while (!rest.done() && !isKeyword(rest.peek()) && !rest.isWord(GROUP)) {
    rest.at += 1;
  }
  return true;
}

/** `RENAME [COLUMN] a TO b`, or MySQL's `RENAME INDEX|KEY a TO b`, as the whole clause. */
function elementRenameShown(
  clause: StatementCursor,
  file: FileContext
): boolean {
  const index =
    file.dialect === "mysql" &&
    (clause.accept("INDEX") || clause.accept("KEY"));
  if (!index) clause.accept("COLUMN");
  return renamePairs(clause)?.length === 1;
}

/**
 * What follows `ADD` or `DROP`: an element word the list names, or a column's name (a quoted name,
 * or a plain word that is not a keyword of another clause).
 */
function elementFollows(
  clause: StatementCursor,
  file: FileContext,
  adding: boolean
): boolean {
  if (adding && clause.accept("CONSTRAINT"))
    return namedConstraintAdded(clause);
  const next = clause.peek();
  if (typeof next !== "string") return clause.name() !== undefined;
  if (adding && MYSQL_INDEX_ELEMENTS.has(next) && file.dialect === "mysql") {
    return !statesIndexOrder(clause.rest());
  }
  return elementWord(next, file.dialect) || plainColumnName(next);
}

/** Words after `ADD` that open an index or key in MySQL's `ALTER TABLE`. */
const MYSQL_INDEX_ELEMENTS = new Set(["INDEX", "KEY", "UNIQUE"]);

/** A named constraint added must be of a kind the snapshot records: not an `EXCLUDE`, say. */
function namedConstraintAdded(clause: StatementCursor): boolean {
  if (clause.name() === undefined) return false;
  return nextIn(clause, CONSTRAINT_KINDS);
}

/** A word naming the element an `ADD` or `DROP` clause changes. */
function elementWord(word: string, dialect: SupportedDialect): boolean {
  return (
    ELEMENT_WORDS.has(word) ||
    (dialect === "mysql" && MYSQL_ELEMENT_WORDS.has(word))
  );
}

/** A plain word read as a column's name: not a keyword of another clause. */
function plainColumnName(word: string): boolean {
  return /^[A-Z_][A-Z0-9_$]*$/.test(word) && !NOT_A_COLUMN.has(word);
}

/** The kinds of constraint the snapshot records. */
const CONSTRAINT_KINDS = new Set(["UNIQUE", "PRIMARY", "FOREIGN", "CHECK"]);

/**
 * Whether what follows a column's new type converts each value by a plain cast of the column
 * itself, as `migrate:create` writes it (`USING "c"` or `USING "c"::<type>`), or names no
 * conversion. Any other `USING` rewrites the values by an expression the snapshot cannot show.
 */
function castsItself(tail: readonly StatementToken[], column: string): boolean {
  const at = tail.indexOf("USING");
  if (at === -1) return true;
  const using = new StatementCursor(tail.slice(at + 1));
  if (using.name() !== column) return false;
  if (using.done()) return true;
  if (!using.accept(":", ":") && !using.accept("::")) return false;
  return using
    .rest()
    .every(
      token =>
        typeof token === "string" &&
        (/^[A-Z_][A-Z0-9_]*$/.test(token) ||
          /^[0-9]+$/.test(token) ||
          ["(", ")", ",", "[", "]"].includes(token))
    );
}

/** Words after `ADD` or `DROP` that change something other than a column. */
const NOT_A_COLUMN = new Set([
  "PARTITION",
  "FULLTEXT",
  "SPATIAL",
  "INDEX",
  "KEY",
  "DEFAULT",
  "EXPRESSION",
  "IDENTITY",
]);

/**
 * A session setting from the short list, a savepoint, or a SQLite rebuild pragma: none outlives the
 * run or changes an object. `SET GLOBAL`, `SET search_path` and anything else are not on it.
 */
function isSessionSetting(
  cursor: StatementCursor,
  dialect: SupportedDialect
): boolean {
  if (cursor.accept("SAVEPOINT") || cursor.accept("RELEASE")) return true;
  if (cursor.accept("ROLLBACK", "TO")) return true;
  if (cursor.accept("PRAGMA")) {
    return dialect === "sqlite" && nextIn(cursor, REBUILD_PRAGMAS);
  }
  if (!cursor.accept("SET")) return false;
  if (!cursor.accept("LOCAL")) cursor.accept("SESSION");
  return nextIn(cursor, SESSION_SETTINGS);
}

/** Whether the next token is a word in `words`. */
function nextIn(cursor: StatementCursor, words: ReadonlySet<string>): boolean {
  const next = cursor.peek();
  return typeof next === "string" && words.has(next);
}

/** Why a pending file at its end is not recorded without running: each condition it fails. */
interface UnprovenReasons {
  /** Its checksum and the snapshot's, when they differ; the snapshot's is blank when it has none. */
  changed?: { checksum: string; recorded: string };
  /** Its unresolved attempt's outcome: failed, or none recorded. */
  attempt?: "failed" | "no-outcome";
  /** Rows dangling through a foreign key it adds (`SnapshotProof.dangling`). */
  dangling?: readonly DanglingReference[];
}

/** The first characters of a checksum, enough to tell two apart. */
const short = (checksum: string): string =>
  checksum.length > 12 ? `${checksum.slice(0, 12)}…` : checksum;

/** How the refusal marks each statement, by its status. */
const MARKS: Record<StatementProof["status"], string> = {
  shown: "the database has it",
  unshown: "not shown by its snapshot",
  "not-done": "the database does not stand as it leaves it",
  unfilled: "rows it fills with its default are still NULL",
  keeps: "the column keeps settings it would reset",
};

/** `n` statements, in words. */
const statementCount = (n: number): string =>
  n === 1 ? "1 statement" : `${n} statements`;

/** Each reason the file is not proven, as the refusal words it. */
function reasonsOf(
  reasons: UnprovenReasons,
  statements: readonly StatementProof[]
): string[] {
  return REASON_LINES.flatMap(line => line(reasons, statements) ?? []);
}

/** One reason's line, or undefined where it does not hold. */
type ReasonLine = (
  reasons: UnprovenReasons,
  statements: readonly StatementProof[]
) => string | undefined;

/** The line for statements of one status, where any is. */
const statusLine =
  (
    status: StatementProof["status"],
    words: (count: number) => string
  ): ReasonLine =>
  (_reasons, statements) => {
    const count = statements.filter(each => each.status === status).length;
    return count > 0 ? words(count) : undefined;
  };

/** Each reason's line, in the order the refusal gives them. */
const REASON_LINES: readonly ReasonLine[] = [
  ({ changed }) =>
    changed === undefined
      ? undefined
      : changed.recorded === ""
        ? "its snapshot records no checksum to show it is the file the snapshot was written with"
        : `it has changed since its snapshot was written (checksum ${short(changed.checksum)}, the snapshot recorded ${short(changed.recorded)})`,
  ({ attempt }) =>
    attempt === undefined
      ? undefined
      : attempt === "failed"
        ? "its last attempt failed"
        : "its last attempt recorded no outcome",
  ({ dangling }) =>
    dangling === undefined ? undefined : danglingLine(dangling),
  statusLine(
    "unshown",
    n =>
      `its snapshot does not show what ${statementCount(n)} ${n === 1 ? "does" : "do"}`
  ),
  statusLine(
    "unfilled",
    n =>
      `the database holds rows ${statementCount(n)} would have filled with ${n === 1 ? "its default" : "their defaults"}, still NULL`
  ),
  statusLine(
    "keeps",
    n => `the database's columns keep settings ${statementCount(n)} would reset`
  ),
  statusLine(
    "not-done",
    n =>
      `the database does not stand as ${statementCount(n)} ${n === 1 ? "leaves" : "leave"} it`
  ),
];

/** The line for rows dangling through a foreign key the file adds. */
function danglingLine(dangling: readonly DanglingReference[]): string {
  const rows = dangling.reduce((sum, entry) => sum + entry.rows, 0);
  // Two added keys between the same two tables are counted apart and named once.
  const pairs = [
    ...new Set(dangling.map(entry => `${entry.table} → ${entry.parent}`)),
  ]
    .slice(0, 5)
    .join(", ");
  return `the database holds ${rows} row(s) referencing rows that do not exist through a foreign key it adds (${pairs}), which a run of it would refuse`;
}

/**
 * The step the refusal names: the statements to look at by hand, where any is marked, or else the
 * change or attempt the reasons name; then the record.
 */
function nextStepOf(
  name: string,
  statements: readonly StatementProof[]
): string {
  const record = `then record the file with \`nextly migrate:resolve --applied ${name}\` and run \`nextly migrate\` again.`;
  return statements.some(statement => statement.status !== "shown")
    ? `Run the statements not marked "the database has it" by hand, or confirm they are not needed, ${record}`
    : `Check that what the file does is in the database, ${record}`;
}

/**
 * The refusal for a pending file the database stands at the end of whose snapshot does not prove
 * all of it, before anything of the file runs or is recorded: it names each statement a recording
 * would have skipped, marked by what the database shows of it. Its message is read back by the
 * CLI's describer (`notProvenParts`): the first sentence, the reasons and the statements, then the
 * next step on the last line.
 */
function notProvenError(args: {
  filename: string;
  statements: readonly StatementProof[];
  reasons: UnprovenReasons;
}): NextlyError {
  const { filename, statements } = args;
  const name = filename.replace(/\.sql$/, "");
  const listed = statements.map(
    (statement, at) =>
      `  ${at + 1}. ${statement.label} (${MARKS[statement.status]})`
  );
  return new NextlyError({
    code: "NEXTLY_MIGRATION_NOT_PROVEN",
    publicMessage: [
      `${filename} is pending, and the database already stands where it ends, not where it starts. It was neither run nor recorded as applied without running: ${reasonsOf(args.reasons, statements).join("; ")}.`,
      "Statements it would have skipped:",
      ...listed,
      nextStepOf(name, statements),
    ].join("\n"),
    logContext: {
      source: filename,
      migration: name,
      reason: "not-proven",
    },
  });
}

/**
 * What `nextly migrate` hands the reconcile for an app file with a snapshot: each statement's
 * reading (`statementsShownBySnapshot`) and the checksum its snapshot recorded when it was
 * written (`migrationHash`, blank when it has none).
 */
export interface SnapshotProof {
  statements: readonly StatementProof[];
  recordedChecksum: string;
  /**
   * On SQLite, the rows referencing rows that do not exist through a foreign key the file adds
   * (`danglingOnAddedKeys`): a run of the file is refused for them, as for any reference it leaves
   * dangling (`refusingNewDanglingReferences`), so its record without running is too.
   */
  dangling?: readonly DanglingReference[];
}

/** Rows of `table` referencing rows of `parent` that do not exist. */
interface DanglingReference {
  table: string;
  parent: string;
  rows: number;
  /**
   * The referencing columns of the key the rows dangle through, where the count names it
   * (`danglingReferences`): two keys between the same two tables are then told apart.
   */
  columns?: readonly string[];
  /**
   * The columns of `parent` that key references, where the count names them: two keys from the
   * same columns to different columns of one parent are then told apart.
   */
  referencesColumns?: readonly string[];
}

/**
 * The dangling references through a foreign key the file adds (`addedForeignKeys`): one its
 * target snapshot declares on a table and its earlier snapshot does not, a key replaced under its
 * own name by one of another shape included. Rows that dangle through a key the database already
 * had are not the file's doing, and a run of it would not be refused for them either.
 */
export function danglingOnAddedKeys(
  sides: { before: NextlySchemaSnapshot; target: NextlySchemaSnapshot },
  dangling: readonly DanglingReference[]
): DanglingReference[] {
  const added = addedForeignKeys(sides).map(({ table, key }) => ({
    pair: `${table}\u0000${key.referencesTable}`.toLowerCase(),
    columns: columnsKey(key.columns),
    references: columnsKey(key.referencesColumns),
  }));
  // A count that names its key is the file's only where an added key has those columns and
  // references the same ones; what a count does not name (a key that could not be read, a key
  // written to its parent's primary key without naming it) is not compared, so the count is laid
  // on any added key it could be: it refuses where it cannot tell.
  return dangling.filter(entry => {
    const pair = `${entry.table}\u0000${entry.parent}`.toLowerCase();
    return added.some(
      key =>
        key.pair === pair &&
        (entry.columns === undefined ||
          entry.columns.length === 0 ||
          key.columns === columnsKey(entry.columns)) &&
        (entry.referencesColumns === undefined ||
          entry.referencesColumns.length === 0 ||
          key.references === columnsKey(entry.referencesColumns))
    );
  });
}

/**
 * The foreign keys the file adds, by the diff's own reading of its two snapshots
 * (`diffSnapshots`): a key the earlier side does not have, and one it has under the same name in
 * another shape (other columns, another target, another action), which the diff drops and adds.
 * Every key of a table the file creates is one it adds.
 */
function addedForeignKeys(sides: {
  before: NextlySchemaSnapshot;
  target: NextlySchemaSnapshot;
}): Array<{ table: string; key: ForeignKeySpec }> {
  const before = new Map(sides.before.tables.map(table => [table.name, table]));
  return sides.target.tables.flatMap(table => {
    const earlier = before.get(table.name);
    if (earlier === undefined) {
      return (table.foreignKeys ?? []).map(key => ({ table: table.name, key }));
    }
    // The two sides of this one table, its keys alone: no other change is asked about.
    const keysOnly = (keys: ForeignKeySpec[] | undefined) => ({
      tables: [{ name: table.name, columns: [], foreignKeys: keys ?? [] }],
    });
    return diffSnapshots(
      keysOnly(earlier.foreignKeys),
      keysOnly(table.foreignKeys)
    ).flatMap(op =>
      op.type === "add_foreign_key"
        ? [{ table: table.name, key: op.foreignKey }]
        : []
    );
  });
}

/** A key's referencing columns as one comparable word, lower-cased, in the order declared. */
const columnsKey = (columns: readonly string[]): string =>
  columns.map(column => column.toLowerCase()).join("\u0000");

/**
 * Refuses, before anything changes, to record a pending app file applied without running it
 * unless its snapshot proves all of it: every statement shown, its checksum the one its snapshot
 * recorded, and no unresolved attempt (`attempt`, read from its ledger rows by the caller), on
 * any dialect.
 */
export function refuseUnlessProven(args: {
  file: { filename: string; sha256?: string };
  proof: SnapshotProof;
  attempt: Pick<SchemaEventRow, "status"> | undefined;
}): void {
  const { file, proof, attempt } = args;
  const checksum = file.sha256 ?? "";
  const reasons: UnprovenReasons = {};
  if (proof.recordedChecksum === "" || proof.recordedChecksum !== checksum) {
    reasons.changed = { checksum, recorded: proof.recordedChecksum };
  }
  if (attempt !== undefined) {
    reasons.attempt = attempt.status === "failed" ? "failed" : "no-outcome";
  }
  if (proof.dangling !== undefined && proof.dangling.length > 0) {
    reasons.dangling = proof.dangling;
  }
  const proven =
    reasons.changed === undefined &&
    reasons.attempt === undefined &&
    reasons.dangling === undefined &&
    proof.statements.every(statement => statement.status === "shown");
  if (proven) return;
  throw notProvenError({
    filename: file.filename,
    statements: proof.statements,
    reasons,
  });
}
