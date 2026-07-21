/**
 * Raw `CREATE TABLE` + index DDL for `nextly_i18n_archive`, per dialect.
 *
 * Holds non-default-locale translations removed when localization is DISABLED on a
 * field/collection, so a mistaken disable is recoverable (a restore can replay these
 * rows). Parallels `getSchemaEventsDdl`: kept as raw DDL so the secondary index is
 * created alongside the table on existing databases. Fresh installs also get the table
 * via `getCoreSchema` + boot-apply. `id` is DB-generated (autoincrement / serial), so
 * archival `INSERT ... SELECT` never has to synthesize a key.
 *
 * @module schemas/nextly-i18n-archive/ddl
 */

type Dialect = "postgresql" | "mysql" | "sqlite";

/** Returns the ordered DDL statements that create the archive table + lookup index. */
export function getI18nArchiveDdl(dialect: Dialect): string[] {
  switch (dialect) {
    case "postgresql":
      return [
        `CREATE TABLE IF NOT EXISTS "nextly_i18n_archive" (
  "id" BIGSERIAL PRIMARY KEY,
  "collection" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "locale" VARCHAR(20) NOT NULL,
  "field" TEXT NOT NULL,
  "value" TEXT,
  "archived_at" TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
        `CREATE INDEX IF NOT EXISTS "nextly_i18n_archive_lookup_idx" ON "nextly_i18n_archive" ("collection", "entry_id", "locale")`,
      ];
    case "mysql":
      // The lookup index is declared inside CREATE TABLE rather than as a
      // following CREATE INDEX. MySQL has no CREATE INDEX IF NOT EXISTS, so a
      // separate statement re-runs against a table that already has the index
      // and fails with a duplicate key name — which every localization-disable
      // after the first would hit, and which the first one hits now that the
      // table can also arrive from the dialect bundle. Inline, the whole thing
      // is covered by IF NOT EXISTS and re-running is a no-op.
      return [
        `CREATE TABLE IF NOT EXISTS \`nextly_i18n_archive\` (
  \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
  \`collection\` VARCHAR(191) NOT NULL,
  \`entry_id\` VARCHAR(191) NOT NULL,
  \`locale\` VARCHAR(20) NOT NULL,
  \`field\` VARCHAR(191) NOT NULL,
  \`value\` LONGTEXT,
  \`archived_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX \`nextly_i18n_archive_lookup_idx\` (\`collection\`, \`entry_id\`, \`locale\`)
)`,
      ];
    case "sqlite":
      return [
        `CREATE TABLE IF NOT EXISTS "nextly_i18n_archive" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "collection" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "value" TEXT,
  -- Stamp new archive rows with the current Unix time in seconds. SQLite stores
  -- this integer column in the same epoch-seconds encoding the app reads back,
  -- so unixepoch() keeps the value decodable rather than the legacy 0 sentinel.
  "archived_at" INTEGER NOT NULL DEFAULT (unixepoch())
)`,
        `CREATE INDEX IF NOT EXISTS "nextly_i18n_archive_lookup_idx" ON "nextly_i18n_archive" ("collection", "entry_id", "locale")`,
      ];
    default: {
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
