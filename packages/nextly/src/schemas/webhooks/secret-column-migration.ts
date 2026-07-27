/**
 * In-place rename of the webhook signing-secret column from `secret_hash` to
 * `secret_ciphertext` on existing installs.
 *
 * The column holds AES-GCM ciphertext (the delivery engine decrypts it to sign),
 * never a hash, so the original name was a misnomer. The Drizzle schema now
 * declares `secret_ciphertext`; without this step the core reconcile would see
 * live `secret_hash` (absent from the desired schema) plus desired
 * `secret_ciphertext` (absent from live) as a destructive DROP + ADD and either
 * refuse to run or, if forced, drop every endpoint's encrypted secrets. Renaming
 * the column in place first makes the diff match, preserving the secrets.
 *
 * It must run BEFORE the core diff (see `migrateCore`), and every statement is
 * guarded so re-runs and fresh installs (which already have `secret_ciphertext`,
 * or have no `nextly_webhooks` table yet) are no-ops. Raw DDL rather than Drizzle
 * for the same reason `getI18nArchiveDdl` / `getSchemaEventsDdl` are: a column
 * RENAME and column introspection are not expressible through the ORM.
 *
 * @module schemas/webhooks/secret-column-migration
 */

type Dialect = "postgresql" | "mysql" | "sqlite";

const TABLE = "nextly_webhooks";
const OLD_COLUMN = "secret_hash";
const NEW_COLUMN = "secret_ciphertext";

/** The minimal adapter surface this migration needs (matches the CLI adapter). */
export interface SecretColumnMigrationAdapter {
  tableExists(name: string): Promise<boolean>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** The live column names of `nextly_webhooks`, read per dialect. */
async function readWebhookColumns(
  adapter: SecretColumnMigrationAdapter,
  dialect: Dialect
): Promise<Set<string>> {
  if (dialect === "sqlite") {
    // SQLite has no information_schema; PRAGMA rows expose the column as `name`.
    const rows = await adapter.executeQuery<{ name: string }>(
      `PRAGMA table_info("${TABLE}")`
    );
    return new Set(rows.map(row => row.name));
  }
  if (dialect === "mysql") {
    const rows = await adapter.executeQuery<{ name: string }>(
      `SELECT COLUMN_NAME AS name FROM information_schema.columns ` +
        `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}'`
    );
    return new Set(rows.map(row => row.name));
  }
  const rows = await adapter.executeQuery<{ name: string }>(
    `SELECT column_name AS name FROM information_schema.columns ` +
      `WHERE table_schema = 'public' AND table_name = '${TABLE}'`
  );
  return new Set(rows.map(row => row.name));
}

/** The dialect-specific `ALTER TABLE … RENAME COLUMN` statement. */
function renameStatement(dialect: Dialect): string {
  switch (dialect) {
    case "mysql":
      // MySQL 8.0 supports RENAME COLUMN (the repo's MySQL matrix is 8.x).
      return `ALTER TABLE \`${TABLE}\` RENAME COLUMN \`${OLD_COLUMN}\` TO \`${NEW_COLUMN}\``;
    case "sqlite":
    case "postgresql":
      // SQLite (>= 3.25) and PostgreSQL share the same RENAME COLUMN syntax; a
      // rename is metadata-only, so SQLite does not need a table rebuild.
      return `ALTER TABLE "${TABLE}" RENAME COLUMN "${OLD_COLUMN}" TO "${NEW_COLUMN}"`;
  }
}

/**
 * Rename `nextly_webhooks.secret_hash` to `secret_ciphertext` in place when, and
 * only when, the old column is present and the new one is not. Returns whether a
 * rename was actually issued (false for fresh installs and re-runs). Data is
 * preserved: a column rename keeps the existing encrypted-secret JSON in place.
 */
export async function ensureWebhookSecretColumnRenamed(
  adapter: SecretColumnMigrationAdapter,
  dialect: Dialect
): Promise<boolean> {
  // Fresh install: the table does not exist yet and the core schema will create
  // it already named `secret_ciphertext`. Nothing to migrate.
  if (!(await adapter.tableExists(TABLE))) return false;

  const columns = await readWebhookColumns(adapter, dialect);
  // Already renamed (or freshly created with the new name): no-op.
  if (columns.has(NEW_COLUMN)) return false;
  // Old column absent too (unexpected shape): leave the diff to report it.
  if (!columns.has(OLD_COLUMN)) return false;

  await adapter.executeQuery(renameStatement(dialect));
  return true;
}
