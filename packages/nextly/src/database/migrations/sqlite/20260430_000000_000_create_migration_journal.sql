-- Migration: create_migration_journal
-- Generated at: 2026-04-30T00:00:00.000Z
-- Dialect: SQLite
--
-- Mirror of the PostgreSQL create_migration_journal migration. See
-- the PG file header for the full why; column shape mirrors
-- packages/nextly/src/schemas/migration-journal/sqlite.ts minus the
-- `batch` column added by the next migration (20260501_journal_batch).
-- SQLite stores timestamps as INTEGER epoch-ms (matches the schema's
-- `mode: "timestamp_ms"`).

-- UP

CREATE TABLE IF NOT EXISTS "nextly_migration_journal" (
  "id"                  TEXT     PRIMARY KEY NOT NULL,
  "source"              TEXT     NOT NULL,
  "status"              TEXT     NOT NULL DEFAULT 'in_progress',
  "started_at"          INTEGER  NOT NULL,
  "ended_at"            INTEGER,
  "duration_ms"         INTEGER,
  "statements_planned"  INTEGER  NOT NULL DEFAULT 0,
  "statements_executed" INTEGER,
  "renames_applied"     INTEGER,
  "error_code"          TEXT,
  "error_message"       TEXT,
  "scope_kind"          TEXT,
  "scope_slug"          TEXT,
  "summary_added"       INTEGER,
  "summary_removed"     INTEGER,
  "summary_renamed"     INTEGER,
  "summary_changed"     INTEGER
);

CREATE INDEX IF NOT EXISTS "nextly_migration_journal_status_idx"
  ON "nextly_migration_journal" ("status");

CREATE INDEX IF NOT EXISTS "nextly_migration_journal_started_at_idx"
  ON "nextly_migration_journal" ("started_at");

CREATE INDEX IF NOT EXISTS "nextly_migration_journal_source_idx"
  ON "nextly_migration_journal" ("source");

-- DOWN

DROP TABLE IF EXISTS "nextly_migration_journal";
