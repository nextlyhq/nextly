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
 * Every statement here MUST be safe to re-apply: the dispatchers run this before each
 * localization disable with no error handling, so one non-idempotent statement breaks
 * disabling permanently. `ddl-idempotency.integration.test.ts` applies it repeatedly on
 * all three dialects to hold that.
 *
 * @module schemas/nextly-i18n-archive/ddl
 */

type Dialect = "postgresql" | "mysql" | "sqlite";

/**
 * The `entity_kind` of a row whose owner is not known: one archived before rows recorded their
 * kind. Every write names its kind, so only the column's default produces it.
 */
export const UNKNOWN_ARCHIVE_KIND = "unknown";

/**
 * The `entity_kind` of a row whose owner could not be told when it was examined
 * (`labelLegacyArchiveRows`). Kept apart from {@link UNKNOWN_ARCHIVE_KIND} so it is never examined
 * again: the registries it was judged against change, and a later look could name the wrong owner.
 */
export const UNRESOLVED_ARCHIVE_KIND = "unresolved";

/** Both kinds of row without an owner: neither is deleted, and either is restored by naming a kind. */
export const UNATTRIBUTED_ARCHIVE_KINDS = [
  UNKNOWN_ARCHIVE_KIND,
  UNRESOLVED_ARCHIVE_KIND,
] as const;

/** Returns the ordered DDL statements that create the archive table + lookup index. */
export function getI18nArchiveDdl(dialect: Dialect): string[] {
  switch (dialect) {
    case "postgresql":
      return [
        `CREATE TABLE IF NOT EXISTS "nextly_i18n_archive" (
  "id" BIGSERIAL PRIMARY KEY,
  "collection" TEXT NOT NULL,
  "entity_kind" VARCHAR(20) NOT NULL DEFAULT 'unknown',
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
  \`entity_kind\` VARCHAR(20) NOT NULL DEFAULT 'unknown',
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
  "entity_kind" TEXT NOT NULL DEFAULT 'unknown',
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

/**
 * The standalone lookup-index statement, for dialects whose table DDL cannot
 * repair a missing index on its own.
 *
 * PostgreSQL and SQLite emit `CREATE INDEX IF NOT EXISTS` alongside the table,
 * so re-running their bootstrap restores an index that went missing. MySQL has
 * no such form: its index is declared inside `CREATE TABLE IF NOT EXISTS`, and
 * MySQL skips that statement entirely when the table exists, so nothing there
 * can put the index back.
 *
 * Nor does the reconcile cover it. `drizzleTableToTableSpec` records only
 * names and columns, so index-only drift produces no operations, and
 * `reconcileCore` returns early when there are none — the push that would
 * repair the index is never reached.
 *
 * Returns `null` where the table DDL already repairs itself.
 */
export function getI18nArchiveIndexRepairDdl(dialect: Dialect): string | null {
  if (dialect !== "mysql") return null;
  return `CREATE INDEX \`nextly_i18n_archive_lookup_idx\` ON \`nextly_i18n_archive\` (\`collection\`, \`entry_id\`, \`locale\`)`;
}

/**
 * Adds `entity_kind` to an archive table created before the column existed.
 *
 * `CREATE TABLE IF NOT EXISTS` skips a table that is already there, so it cannot add a column to
 * one. `nextly migrate` and boot add it through the core reconcile; this statement is for the
 * paths that write the archive without one having run. Existing rows take the default, unknown:
 * collections, Singles and field groups all archived before the kind was recorded, so no one kind is
 * true of them (`labelLegacyArchiveRows` names the owner where it can). PostgreSQL skips it
 * when the column is there; MySQL and SQLite have no such form and report a duplicate column,
 * which the caller tolerates.
 */
const KIND_UPGRADE_DDL: Record<Dialect, string> = {
  postgresql: `ALTER TABLE "nextly_i18n_archive" ADD COLUMN IF NOT EXISTS "entity_kind" VARCHAR(20) NOT NULL DEFAULT 'unknown'`,
  mysql:
    "ALTER TABLE `nextly_i18n_archive` ADD COLUMN `entity_kind` VARCHAR(20) NOT NULL DEFAULT 'unknown'",
  sqlite: `ALTER TABLE "nextly_i18n_archive" ADD COLUMN "entity_kind" TEXT NOT NULL DEFAULT 'unknown'`,
};

export function getI18nArchiveKindUpgradeDdl(dialect: Dialect): string {
  return KIND_UPGRADE_DDL[dialect];
}
