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
 * A MySQL string literal, read back as `text` in every SQL mode. Quotes are doubled. A backslash,
 * which MySQL reads as an escape unless `NO_BACKSLASH_ESCAPES` is set, is never written into one:
 * a text holding one, such as a column named `caption\suffix`, is the CONCAT of the literals
 * around it with `CHAR(92)` between them (`BACKSLASH_PART`).
 */
const literal = (text: string): string => {
  const parts = text.split("\\").map(part => `'${part.replace(/'/g, "''")}'`);
  return parts.length === 1
    ? parts[0]
    : `CONCAT(${parts.join(BACKSLASH_PART)})`;
};

/** What stands for a backslash between two parts of a literal (`literal`). */
const BACKSLASH_PART = ", CHAR(92 USING utf8mb4), ";

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

/** A backslash, spelled so that no SQL mode can read it as an escape. */
const BACKSLASH = "CHAR(92 USING utf8mb4)";

/**
 * `expression` with the escaping layer `information_schema` adds taken off: the catalog stores a
 * default expression or a check's clause with a backslash before each quote and each backslash of
 * the expression as MySQL prints it (`_utf8mb4\'draft\'`). Taking it off in one pass, each `\x`
 * to `x`, leaves the expression as MySQL printed it, which is DDL again (`introspect-live.ts`
 * reads a clause the same way). Converted first, to the backslash's character set and collation:
 * the catalog's columns are utf8mb3, and MySQL refuses to compare the two.
 */
const decoded = (expression: string): string =>
  `REGEXP_REPLACE(CONVERT(${expression} USING utf8mb4) COLLATE utf8mb4_bin, CONCAT(${BACKSLASH}, ${BACKSLASH}, '(.)'), '$1', 1, 0, 'n')`;

/** Whether this session reads a backslash as an ordinary character. */
const NO_BACKSLASH_ESCAPES = "@@SESSION.sql_mode LIKE '%NO_BACKSLASH_ESCAPES%'";

/**
 * `value` as a string literal this session reads back as `value`. QUOTE() escapes with
 * backslashes, which a session in `NO_BACKSLASH_ESCAPES` reads as ordinary characters, so there
 * the quotes are doubled instead and nothing else is touched.
 */
const quotedForSession = (value: string): string =>
  `IF(${NO_BACKSLASH_ESCAPES}, CONCAT('''', REPLACE(${value}, '''', ''''''), ''''), QUOTE(${value}))`;

/**
 * Whether `expression`, as MySQL prints it, cannot be written into this session's DDL: MySQL
 * prints a quote inside a literal with a backslash before it, which a `NO_BACKSLASH_ESCAPES`
 * session would not read as one.
 */
const unreadableHere = (expression: string): string =>
  `(${NO_BACKSLASH_ESCAPES} AND INSTR(${expression}, ${BACKSLASH}) > 0)`;

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
 * (`DEFAULT_GENERATED`) in parentheses, with the catalog's escaping taken off (`decoded`), except
 * `CURRENT_TIMESTAMP`, which is written bare as MySQL writes it; a BIT literal as it is; any other
 * value, and the comment, quoted as this session reads quotes (`quotedForSession`).
 *
 * A column the database does not have, or an expression default a `NO_BACKSLASH_ESCAPES` session
 * cannot read back, leaves the variable holding a sentence saying so, which PREPARE rejects with
 * that sentence in its message.
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
      `CONCAT(' DEFAULT (', ${decoded("COLUMN_DEFAULT")}, ')')), ` +
      `CONCAT(' DEFAULT ', IF(DATA_TYPE = 'bit', COLUMN_DEFAULT, ${quotedForSession("COLUMN_DEFAULT")}))))`,
    "IF(EXTRA LIKE '%auto_increment%', ' AUTO_INCREMENT', '')",
    "IF(EXTRA LIKE '%on update %', CONCAT(' ON UPDATE ', REGEXP_SUBSTR(EXTRA, '(?<=on update )[^ ]+')), '')",
    "IF(EXTRA LIKE '%INVISIBLE%', ' INVISIBLE', '')",
    `IF(COLUMN_COMMENT = '', '', CONCAT(' COMMENT ', ${quotedForSession("COLUMN_COMMENT")}))`,
  ].join(", ");
  const unwritable = `EXTRA LIKE '%DEFAULT_GENERATED%' AND ${unreadableHere(decoded("COLUMN_DEFAULT"))}`;
  return runBuilt(
    `COALESCE((SELECT IF(${unwritable}, ${literal(`cannot restate ${op.tableName}.${op.columnName}: its default needs backslash escapes`)}, CONCAT(${definition})) ` +
      `FROM information_schema.COLUMNS WHERE ${columnFilter(op.tableName, op.columnName)}), ` +
      `${literal(`column ${op.tableName}.${op.columnName} is not in this database`)})`
  );
}

/**
 * `RENAME COLUMN`, with every check that uses the column dropped and added again under the same
 * name around it, in one ALTER. MySQL refuses the rename while such a check exists, and accepts the
 * three together. Each check is added back as it was, enforced or not, with the column's name
 * replaced where the catalog quotes it (`CHECK_CLAUSE` always backquotes a column), in the clause
 * with the catalog's escaping taken off (`decoded`). A table with no such check gets the bare
 * rename.
 *
 * The checks are joined with GROUP_CONCAT, which cuts its result at `group_concat_max_len`. Rather
 * than run a statement cut short, the variable then holds a sentence saying so, which PREPARE
 * rejects; the same for a check whose clause names the column inside a string literal, which the
 * author renames by hand, or that a `NO_BACKSLASH_ESCAPES` session cannot read back. MySQL quotes about eighty characters of the rejected text in its error,
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
    `REPLACE(${decoded("cc.CHECK_CLAUSE")}, ${from}, ${literal(q(op.toColumn))}), IF(tc.ENFORCED = 'NO', ' NOT ENFORCED', '')) ` +
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
  // one, holds a quote the count cannot pair, or holds a backslash (MySQL prints a quote inside a
  // literal as `\'`, which the count would read as the literal's end), is not rewritten.
  const clause = decoded("cc.CHECK_CLAUSE");
  const literalFree = `REGEXP_REPLACE(${clause}, ${literal("'[^']*'")}, '')`;
  const namings = (text: string) =>
    `(LENGTH(${text}) - LENGTH(REPLACE(${text}, ${from}, '')))`;
  const unsafe =
    `(SELECT COUNT(*) ${checksOnColumn} AND (${namings(clause)} <> ${namings(literalFree)} ` +
    `OR INSTR(${literalFree}, ${literal("'")}) > 0 OR INSTR(${clause}, ${BACKSLASH}) > 0)) > 0`;
  return runBuilt(
    `IF(${tooLong}, ${literal(`the checks on ${op.tableName} are too long to restate around a rename`)}, ` +
      `IF(${unsafe}, ${literal(`cannot rename ${op.tableName}.${op.fromColumn}: a check names it inside a string`)}, ${statement}))`
  );
}

/** What the first statement of a run says it changes, read back from its text. */
const RENAME_RUN =
  /^SET @nextly_ddl = .*'ALTER TABLE `([^`]+)` '.*'RENAME COLUMN `([^`]+)` TO `([^`]+)`'/s;
const NULLABILITY_RUN =
  /^SET @nextly_ddl = COALESCE\(\(SELECT .*'ALTER TABLE `([^`]+)` MODIFY COLUMN `([^`]+)` ', .*' (NOT NULL|NULL)'/s;

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

/**
 * A name as the run spells it inside a SQL string literal, read back: `literal` doubles each
 * apostrophe, so `app_o''brien` is the table `app_o'brien`, and writes a backslash as `CHAR(92)`
 * between two literals. Read as written, the name would be
 * rendered with its apostrophes doubled twice and never match the run.
 */
const unliteral = (spelled: string): string =>
  spelled.split(`'${BACKSLASH_PART}'`).join("\\").replace(/''/g, "'");

/** The plain statement a four-statement run amounts to, when it is exactly one of this module's. */
function plainEquivalentOf(run: readonly string[]): string | undefined {
  const first = run[0] ?? "";
  const rename = RENAME_RUN.exec(first);
  if (rename !== null) {
    const [tableName, fromColumn, toColumn] = rename.slice(1).map(unliteral);
    return sameRun(
      run,
      renameKeepingChecks({ tableName, fromColumn, toColumn })
    )
      ? `ALTER TABLE ${q(tableName)} RENAME COLUMN ${q(fromColumn)} TO ${q(toColumn)}`
      : undefined;
  }
  const nullability = NULLABILITY_RUN.exec(first);
  if (nullability !== null) {
    const [tableName, columnName] = nullability.slice(1, 3).map(unliteral);
    const setting = nullability[3];
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
