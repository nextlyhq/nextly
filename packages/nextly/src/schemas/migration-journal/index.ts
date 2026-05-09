// Public exports for the nextly_migration_journal table — F8 PR 5.
//
// Distinct from `schemas/migrations/` (the file-based migration
// ledger powering `nextly migrate` / `nextly migrate:status`). The
// journal records every pipeline apply for audit/observability;
// migrations records intentional file-based migrations.

export type {
  MigrationJournalSource,
  MigrationJournalStatus,
  MigrationJournalScopeKind,
} from "./types";

export {
  nextlyMigrationJournalPg,
  type NextlyMigrationJournalPg,
  type NextlyMigrationJournalInsertPg,
} from "./postgres";

export {
  nextlyMigrationJournalMysql,
  type NextlyMigrationJournalMysql,
  type NextlyMigrationJournalInsertMysql,
} from "./mysql";

export {
  nextlyMigrationJournalSqlite,
  type NextlyMigrationJournalSqlite,
  type NextlyMigrationJournalInsertSqlite,
} from "./sqlite";
