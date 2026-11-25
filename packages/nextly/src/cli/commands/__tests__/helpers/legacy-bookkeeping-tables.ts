/**
 * The migration bookkeeping tables an earlier release kept (`nextly_migrations`, the applied
 * files; `nextly_migration_journal`, the pushes), as it created them, for a test standing in for
 * a database that release left. No release creates them now, so they have no production DDL to
 * reuse; one definition here serves every test that needs them.
 */
import type { TestDialect } from "../../../../plugins/test-nextly";

/** The file ledger, as `nextly migrate` kept it before `nextly_schema_events`. */
export function fileLedgerDdl(dialect: TestDialect): string[] {
  if (dialect === "postgresql") {
    return [
      `CREATE TABLE "nextly_migrations" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "filename" TEXT NOT NULL UNIQUE, "sha256" CHAR(64) NOT NULL, "status" TEXT NOT NULL, "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "applied_by" TEXT, "duration_ms" INTEGER, "error_json" JSONB)`,
    ];
  }
  if (dialect === "mysql") {
    return [
      "CREATE TABLE `nextly_migrations` (`id` VARCHAR(36) PRIMARY KEY, `filename` VARCHAR(255) NOT NULL UNIQUE, `sha256` CHAR(64) NOT NULL, `status` VARCHAR(20) NOT NULL, `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `applied_by` VARCHAR(255), `duration_ms` INT, `error_json` JSON)",
    ];
  }
  return [
    `CREATE TABLE "nextly_migrations" ("id" TEXT PRIMARY KEY, "filename" TEXT NOT NULL UNIQUE, "sha256" TEXT NOT NULL, "status" TEXT NOT NULL, "applied_at" INTEGER NOT NULL, "applied_by" TEXT, "duration_ms" INTEGER, "error_json" TEXT)`,
  ];
}

/** The journal an earlier release kept beside the ledger. */

/** The push journal, as an earlier release kept it beside the file ledger. */
export function journalDdl(dialect: TestDialect): string {
  const q = dialect === "mysql" ? "`" : '"';
  const time =
    dialect === "postgresql"
      ? "TIMESTAMPTZ"
      : dialect === "mysql"
        ? "DATETIME(3)"
        : "INTEGER";
  const columns = [
    "id VARCHAR(36) PRIMARY KEY",
    "source VARCHAR(20) NOT NULL",
    "status VARCHAR(20) NOT NULL",
    `started_at ${time}`,
    `ended_at ${time}`,
    "duration_ms INTEGER",
    "scope_kind VARCHAR(20)",
    "scope_slug VARCHAR(255)",
  ].map(column => column.replace(/^(\w+)/, `${q}$1${q}`));
  return `CREATE TABLE ${q}nextly_migration_journal${q} (${columns.join(", ")})`;
}
