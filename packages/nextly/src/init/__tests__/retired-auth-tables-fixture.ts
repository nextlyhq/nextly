/**
 * The retired `accounts` and `sessions` tables, created by hand for
 * integration tests on every dialect.
 *
 * Hand-written DDL on purpose: the production definitions of these tables
 * were removed so nothing creates them again, and these stand in for an
 * upgraded database that still has them, or for a host app's own table of the
 * same name.
 */
import type { TestDialect } from "../../plugins/test-nextly";

/** The adapter surface the fixture writes through. */
interface RawExecutor {
  executeQuery(sql: string, params?: unknown[]): Promise<unknown>;
}

/** A key column's type: MySQL cannot index an unbounded `TEXT` column. */
function keyType(dialect: TestDialect): string {
  return dialect === "mysql" ? "VARCHAR(191)" : "TEXT";
}

/** The `n`th bound parameter of a statement, as the dialect spells it. */
export function bindParam(dialect: TestDialect, n: number): string {
  return dialect === "postgresql" ? `$${n}` : "?";
}

/** `accounts` and `sessions` in the shape Nextly created them. */
export async function createRetiredAuthTables(
  db: RawExecutor,
  dialect: TestDialect
): Promise<void> {
  const key = keyType(dialect);
  await db.executeQuery(
    `CREATE TABLE accounts (id ${key} PRIMARY KEY, user_id ${key} NOT NULL,
       type TEXT, provider TEXT NOT NULL, provider_account_id TEXT NOT NULL,
       access_token TEXT)`
  );
  await db.executeQuery(
    `CREATE TABLE sessions (session_token ${key} PRIMARY KEY,
       user_id ${key} NOT NULL, expires BIGINT NOT NULL)`
  );
}

/** A host app's own `accounts` table, which only shares the name. */
export async function createHostAccountsTable(
  db: RawExecutor,
  dialect: TestDialect
): Promise<void> {
  await db.executeQuery(
    `CREATE TABLE accounts (id ${keyType(dialect)} PRIMARY KEY, owner_id TEXT, balance INTEGER)`
  );
}

/** Insert one row into a retired-shape or host table. */
export async function insertRow(
  db: RawExecutor,
  dialect: TestDialect,
  table: "accounts" | "sessions",
  values: unknown[]
): Promise<void> {
  const params = values.map((_, i) => bindParam(dialect, i + 1)).join(", ");
  await db.executeQuery(`INSERT INTO ${table} VALUES (${params})`, values);
}

/** Drop whichever of the two tables a case left behind. */
export async function dropRetiredAuthTables(db: RawExecutor): Promise<void> {
  await db.executeQuery("DROP TABLE IF EXISTS accounts");
  await db.executeQuery("DROP TABLE IF EXISTS sessions");
}
