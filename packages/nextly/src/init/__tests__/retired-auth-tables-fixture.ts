/**
 * The retired `accounts`, `sessions` and `user_permission_cache` tables,
 * created by hand for integration tests on every dialect.
 *
 * Hand-written DDL on purpose: the production definitions of these tables
 * were removed so nothing creates them again, and these stand in for an
 * upgraded database that still has them, or for a host app's own table of the
 * same name.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * The statements that created `user_permission_cache` on `dialect`, as
 * drizzle-kit wrote them for the release that used the table: its columns and
 * their types, its indexes, and on PostgreSQL and SQLite its foreign key to
 * `users`. Read from the captured historical DDL rather than written here, so
 * the tests run against the table Nextly created and not an approximation.
 */
function storedPermissionAnswersDdl(dialect: TestDialect): string[] {
  const file = dialect === "postgresql" ? "postgres" : dialect;
  const captured = JSON.parse(
    readFileSync(
      join(
        __dirname,
        "../../domains/schema/pipeline/__tests__/v1-golden/fixtures-045",
        `${file}.json`
      ),
      "utf8"
    )
  ) as { statements: string[] };
  const statements = captured.statements.filter(statement =>
    statement.includes("user_permission_cache")
  );
  if (statements.length === 0) {
    throw new Error(`no captured user_permission_cache DDL for ${dialect}`);
  }
  return statements;
}

/** `user_permission_cache` as Nextly created it on `dialect`. */
export async function createStoredPermissionAnswersTable(
  db: RawExecutor,
  dialect: TestDialect
): Promise<void> {
  for (const statement of storedPermissionAnswersDdl(dialect)) {
    await db.executeQuery(statement);
  }
}

/**
 * One stored "yes" for `userId`, in the column order and value types the
 * table has on `dialect`. The user must exist where the table has its
 * foreign key.
 */
export function storedAnswerRow(
  dialect: TestDialect,
  row: { id: string; userId: string }
): unknown[] {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 300_000);
  if (dialect === "sqlite") {
    const seconds = (at: Date) => Math.floor(at.getTime() / 1000);
    return [
      row.id,
      row.userId,
      "read",
      "notes",
      1,
      "[]",
      seconds(expiresAt),
      seconds(createdAt),
    ];
  }
  return [
    row.id,
    row.userId,
    "read",
    "notes",
    dialect === "postgresql" ? true : 1,
    "[]",
    expiresAt,
    createdAt,
  ];
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
  table: "accounts" | "sessions" | "user_permission_cache",
  values: unknown[]
): Promise<void> {
  const params = values.map((_, i) => bindParam(dialect, i + 1)).join(", ");
  await db.executeQuery(`INSERT INTO ${table} VALUES (${params})`, values);
}

/** Drop whichever of the retired tables a case left behind. */
export async function dropRetiredAuthTables(db: RawExecutor): Promise<void> {
  await db.executeQuery("DROP TABLE IF EXISTS accounts");
  await db.executeQuery("DROP TABLE IF EXISTS sessions");
  await db.executeQuery("DROP TABLE IF EXISTS user_permission_cache");
}
