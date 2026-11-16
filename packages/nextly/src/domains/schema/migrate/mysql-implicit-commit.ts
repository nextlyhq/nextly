/**
 * Which statements commit MySQL's open transaction implicitly.
 *
 * MySQL commits the open transaction before and after a CREATE, ALTER, DROP or RENAME of a table
 * or an index (the column, key and check changes are an ALTER TABLE's). A temporary table's CREATE
 * and DROP do not commit. After such a commit the session is back in autocommit, so a unit that
 * runs in one transaction opens it again (`runMigrationStatements`), and the statements after the
 * commit roll back together, as the ones before it would have.
 *
 * A statement that commits but is not read as one here (a view's CREATE, a TRUNCATE) is one no
 * later try may send again (`judgeStatement` reads it as unread), so a run stops rather than send
 * it twice.
 *
 * @module domains/schema/migrate/mysql-implicit-commit
 */
import { leadingWords } from "./split-sql";

/** The objects whose creation, change, drop or rename commits MySQL's transaction, by verb. */
const MYSQL_COMMITTING: Readonly<Record<string, ReadonlySet<string>>> = {
  CREATE: new Set(["TABLE", "INDEX"]),
  ALTER: new Set(["TABLE", "INDEX"]),
  DROP: new Set(["TABLE", "INDEX"]),
  RENAME: new Set(["TABLE"]),
};

/** The kinds of index MySQL writes before `INDEX`. */
const INDEX_KINDS = new Set(["UNIQUE", "FULLTEXT", "SPATIAL"]);

/** Whether MySQL commits the open transaction implicitly before and after `statement`. */
export function commitsOnMysql(statement: string): boolean {
  const [first, second, third] = leadingWords(statement, "mysql", 3);
  const objects = MYSQL_COMMITTING[first ?? ""];
  if (objects === undefined) return false;
  // `CREATE UNIQUE|FULLTEXT|SPATIAL INDEX`: the object is the third word.
  const object =
    first === "CREATE" && INDEX_KINDS.has(second ?? "") ? third : second;
  return objects.has(object ?? "");
}
