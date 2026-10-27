/**
 * MySQL statements for a migration file that keep what the snapshot does not record.
 *
 * A migration file is written from snapshots, and a snapshot records a column's type, nullability
 * and default, never its comment, character set or collation, nor a check the schema does not
 * declare. Two MySQL statements need exactly what it does not record:
 *
 * - Changing a column's nullability. MySQL has no statement for it alone: `MODIFY COLUMN` restates
 *   the whole definition and drops whatever it leaves out (the MySQL `ALTER TABLE` documentation on
 *   `CHANGE` and `MODIFY`). A MODIFY written from the snapshot would delete the comment and reset
 *   the collation to the table's.
 * - Renaming a column a CHECK uses. MySQL refuses it outright (error 3959, "Check constraint ...
 *   uses column ..., hence column cannot be dropped or renamed"), and the check's text is not in
 *   the snapshot either.
 *
 * So each is written as a statement the database builds when the file runs, from its own catalog:
 * the definition is read from `information_schema` into a user variable, prepared and executed. The
 * runner runs a file on one connection, so the variable and the prepared statement live exactly as
 * long as the four statements need them, and it allows a `SET` of a user variable.
 *
 * Only `generateStatements` uses these, for migration files. A caller that hands statements to the
 * driver one by one through `generateSQL` keeps the plain forms.
 *
 * @module domains/schema/pipeline/sql-templates/mysql-live-restate
 */
import type {
  ChangeColumnNullableOp,
  Operation,
  RenameColumnOp,
} from "../diff/types";

import { quoteIdent } from "./identifier-quoting";

const q = (name: string) => quoteIdent(name, "mysql");

/**
 * A MySQL string literal. Quotes are doubled; a backslash, which MySQL reads as an escape unless
 * `NO_BACKSLASH_ESCAPES` is set, is never written into one: the one place that needs it spells it
 * `CHAR(92)`.
 */
const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`;

/** The variable and prepared statement these use. One name, reused: each set replaces the last. */
const VARIABLE = "@nextly_ddl";
const PREPARED = "nextly_ddl";

/** The statements that prepare and run what `assignment` puts in the variable. */
function runBuilt(assignment: string): string[] {
  return [
    `SET ${VARIABLE} = ${assignment}`,
    `PREPARE ${PREPARED} FROM ${VARIABLE}`,
    `EXECUTE ${PREPARED}`,
    `DEALLOCATE PREPARE ${PREPARED}`,
  ];
}

/**
 * The file's statements for `op` on MySQL, when they must be built from the live catalog, or
 * `undefined` for every other operation, which renders as `generateSQL` renders it.
 */
export function mysqlLiveStatements(op: Operation): string[] | undefined {
  switch (op.type) {
    case "change_column_nullable":
      return restatedNullability(op);
    case "rename_column":
      return renameKeepingChecks(op);
    default:
      return undefined;
  }
}

/** The filter that finds one column of one table in this database. */
function columnFilter(table: string, column: string): string {
  return `TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${literal(table)} AND COLUMN_NAME = ${literal(column)}`;
}

/**
 * `MODIFY COLUMN` with the nullability the operation asks for and everything else as the column
 * has it now: its type, character set and collation, a generated column's expression, its default,
 * `AUTO_INCREMENT`, `ON UPDATE`, visibility and comment. Position, indexes, keys and checks are
 * not part of a column's definition and MODIFY leaves them where they are.
 *
 * A default is restated the way `information_schema` reports it: an expression default
 * (`DEFAULT_GENERATED`) in parentheses, with the backslash the catalog puts before each quote taken
 * out, except `CURRENT_TIMESTAMP`, which is written bare as MySQL writes it; a BIT literal as it is;
 * any other value quoted.
 *
 * A column the database does not have leaves the variable holding a sentence naming it, which
 * PREPARE rejects with that sentence in its message.
 */
function restatedNullability(op: ChangeColumnNullableOp): string[] {
  const definition = [
    literal(
      `ALTER TABLE ${q(op.tableName)} MODIFY COLUMN ${q(op.columnName)} `
    ),
    "COLUMN_TYPE",
    "IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME))",
    "IF(COALESCE(GENERATION_EXPRESSION, '') = '', '', CONCAT(' GENERATED ALWAYS AS (', GENERATION_EXPRESSION, ')', IF(EXTRA LIKE '%STORED GENERATED%', ' STORED', ' VIRTUAL')))",
    literal(op.toNullable ? " NULL" : " NOT NULL"),
    "IF(COLUMN_DEFAULT IS NULL, '', IF(EXTRA LIKE '%DEFAULT_GENERATED%', " +
      "IF(LEFT(COLUMN_DEFAULT, 17) = 'CURRENT_TIMESTAMP', CONCAT(' DEFAULT ', COLUMN_DEFAULT), " +
      "CONCAT(' DEFAULT (', REPLACE(COLUMN_DEFAULT, CONCAT(CHAR(92), ''''), ''''), ')')), " +
      "CONCAT(' DEFAULT ', IF(DATA_TYPE = 'bit', COLUMN_DEFAULT, QUOTE(COLUMN_DEFAULT)))))",
    "IF(EXTRA LIKE '%auto_increment%', ' AUTO_INCREMENT', '')",
    "IF(EXTRA LIKE '%on update %', CONCAT(' ON UPDATE ', REGEXP_SUBSTR(EXTRA, '(?<=on update )[^ ]+')), '')",
    "IF(EXTRA LIKE '%INVISIBLE%', ' INVISIBLE', '')",
    "IF(COLUMN_COMMENT = '', '', CONCAT(' COMMENT ', QUOTE(COLUMN_COMMENT)))",
  ].join(", ");
  return runBuilt(
    `COALESCE((SELECT CONCAT(${definition}) FROM information_schema.COLUMNS WHERE ${columnFilter(op.tableName, op.columnName)}), ` +
      `${literal(`column ${op.tableName}.${op.columnName} is not in this database`)})`
  );
}

/**
 * `RENAME COLUMN`, with every check that uses the column dropped and added again under the same
 * name around it, in one ALTER. MySQL refuses the rename while such a check exists, and accepts the
 * three together. Each check is added back as it was, enforced or not, with the column's name
 * replaced where the catalog quotes it (`CHECK_CLAUSE` always backquotes a column). A table with
 * no such check gets the bare rename.
 *
 * The checks are joined with GROUP_CONCAT, which cuts its result at `group_concat_max_len`. Rather
 * than run a statement cut short, the variable then holds a sentence saying so, which PREPARE
 * rejects; the same for a check whose clause names the column inside a string literal, which the
 * author renames by hand. MySQL quotes about eighty characters of the rejected text in its error,
 * so each sentence leads with what failed.
 */
function renameKeepingChecks(
  op: Pick<RenameColumnOp, "tableName" | "fromColumn" | "toColumn">
): string[] {
  const from = literal(q(op.fromColumn));
  const checksOnColumn =
    "FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc " +
    "ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME " +
    `WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ${literal(op.tableName)} ` +
    `AND tc.CONSTRAINT_TYPE = 'CHECK' AND INSTR(cc.CHECK_CLAUSE, ${from}) > 0`;
  const checkName = "CONCAT('`', REPLACE(cc.CONSTRAINT_NAME, '`', '``'), '`')";
  const drops =
    `(SELECT GROUP_CONCAT(CONCAT('DROP CHECK ', ${checkName}) ORDER BY cc.CONSTRAINT_NAME SEPARATOR ', ') ` +
    `${checksOnColumn})`;
  const adds =
    `(SELECT GROUP_CONCAT(CONCAT('ADD CONSTRAINT ', ${checkName}, ' CHECK ', ` +
    `REPLACE(cc.CHECK_CLAUSE, ${from}, ${literal(q(op.toColumn))}), IF(tc.ENFORCED = 'NO', ' NOT ENFORCED', '')) ` +
    `ORDER BY cc.CONSTRAINT_NAME SEPARATOR ', ') ${checksOnColumn})`;
  const tooLong =
    `(SELECT COALESCE(SUM(2 * LENGTH(cc.CHECK_CLAUSE) + 4 * LENGTH(cc.CONSTRAINT_NAME) + 64), 0) ` +
    `${checksOnColumn}) >= @@group_concat_max_len`;
  const statement =
    `CONCAT(${literal(`ALTER TABLE ${q(op.tableName)} `)}, CONCAT_WS(', ', ${drops}, ` +
    `${literal(`RENAME COLUMN ${q(op.fromColumn)} TO ${q(op.toColumn)}`)}, ${adds}))`;
  // The column's name is replaced wherever the clause quotes it, so a string literal that happens
  // to hold the quoted name would change too, and the check would then test something else. The
  // literals are taken out to count the name outside them; a check that names the column inside
  // one, or holds a quote the count cannot pair, is not rewritten.
  const literalFree = `REGEXP_REPLACE(cc.CHECK_CLAUSE, ${literal("'[^']*'")}, '')`;
  const namings = (text: string) =>
    `(LENGTH(${text}) - LENGTH(REPLACE(${text}, ${from}, '')))`;
  const unsafe =
    `(SELECT COUNT(*) ${checksOnColumn} AND (${namings("cc.CHECK_CLAUSE")} <> ${namings(literalFree)} ` +
    `OR INSTR(${literalFree}, ${literal("'")}) > 0)) > 0`;
  return runBuilt(
    `IF(${tooLong}, ${literal(`the checks on ${op.tableName} are too long to restate around a rename`)}, ` +
      `IF(${unsafe}, ${literal(`cannot rename ${op.tableName}.${op.fromColumn}: a check names it inside a string`)}, ${statement}))`
  );
}

/** What the first statement of a run says it changes, read back from its text. */
const RENAME_RUN =
  /^SET @nextly_ddl = .*'ALTER TABLE `([^`]+)` '.*'RENAME COLUMN `([^`]+)` TO `([^`]+)`'/s;
const NULLABILITY_RUN =
  /^SET @nextly_ddl = COALESCE\(\(SELECT CONCAT\('ALTER TABLE `([^`]+)` MODIFY COLUMN `([^`]+)` ', .*' (NOT NULL|NULL)'/s;

/**
 * `statements` with each run this module writes replaced by the one plain statement it amounts to,
 * for a reader that judges statements by their text and cannot see into a prepared one: the drop
 * guard refuses PREPARE and EXECUTE, because a statement built at run time could drop anything.
 *
 * A run is recognised only when all four of its statements are exactly what this module renders
 * for the table and columns its first one names, so a hand-written PREPARE stays unreadable and is
 * refused as before. A rename run amounts to the plain rename (the checks it drops it adds back
 * under the same names), a nullability run to a MODIFY of that column.
 */
export function plainMysqlEquivalents(statements: readonly string[]): string[] {
  const out: string[] = [];
  for (let at = 0; at < statements.length; at++) {
    const run = statements.slice(at, at + 4).map(statement => statement.trim());
    const plain = plainEquivalentOf(run);
    if (plain === undefined) {
      out.push(statements[at]);
      continue;
    }
    out.push(plain);
    at += 3;
  }
  return out;
}

/** The plain statement a four-statement run amounts to, when it is exactly one of this module's. */
function plainEquivalentOf(run: readonly string[]): string | undefined {
  const first = run[0] ?? "";
  const rename = RENAME_RUN.exec(first);
  if (rename !== null) {
    const [, tableName, fromColumn, toColumn] = rename;
    return sameRun(
      run,
      renameKeepingChecks({ tableName, fromColumn, toColumn })
    )
      ? `ALTER TABLE ${q(tableName)} RENAME COLUMN ${q(fromColumn)} TO ${q(toColumn)}`
      : undefined;
  }
  const nullability = NULLABILITY_RUN.exec(first);
  if (nullability !== null) {
    const [, tableName, columnName, setting] = nullability;
    const toNullable = setting === "NULL";
    const op: ChangeColumnNullableOp = {
      type: "change_column_nullable",
      tableName,
      columnName,
      fromNullable: !toNullable,
      toNullable,
    };
    return sameRun(run, restatedNullability(op))
      ? `ALTER TABLE ${q(tableName)} MODIFY COLUMN ${q(columnName)} text ${setting}`
      : undefined;
  }
  return undefined;
}

function sameRun(run: readonly string[], rendered: readonly string[]): boolean {
  return (
    run.length === rendered.length &&
    rendered.every((statement, i) => run[i] === statement)
  );
}
