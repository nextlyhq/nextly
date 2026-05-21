-- Migration: create_migration_journal
-- Generated at: 2026-04-30T00:00:00.000Z
-- Dialect: PostgreSQL
--
-- Creates the `nextly_migration_journal` table that the F8 PR-5
-- audit pipeline + the runtime first-run probe both depend on. Prior
-- to this migration, the table was declared in the Drizzle schema
-- (packages/nextly/src/schemas/migration-journal/postgres.ts) but
-- nothing in the bundled migration chain actually created it, so:
--
--   • `nextly migrate` on a fresh DB failed at the immediately-next
--     migration (`20260501_000000_journal_batch.sql`) with
--     `relation "nextly_migration_journal" does not exist` because
--     the ALTER had nothing to alter.
--   • The runtime first-run probe (`PROBE_TABLE` in src/init/first-run.ts)
--     never found the table, so it incorrectly re-ran setup on every
--     cold boot — surfacing as an interactive drizzle-kit prompt that
--     offered destructive "rename example_users → nextly_migration_journal"
--     options.
--
-- Synthetic 000000_000 time component sorts this file strictly
-- between `20260429_000000_000_initial_journal.sql` (creates the
-- unrelated `nextly_migrations` file-ledger table) and the existing
-- `20260501_000000_journal_batch.sql` (now succeeds against the table
-- this migration creates).
--
-- Column shape mirrors `nextly_migration_journal` from
-- src/schemas/migration-journal/postgres.ts, minus the `batch`
-- column which the existing 20260501 migration adds next.

-- UP

CREATE TABLE IF NOT EXISTS "nextly_migration_journal" (
  "id"                  text         PRIMARY KEY,
  "source"              varchar(20)  NOT NULL,
  "status"              varchar(20)  NOT NULL DEFAULT 'in_progress',
  "started_at"          timestamptz  NOT NULL,
  "ended_at"            timestamptz,
  "duration_ms"         integer,
  "statements_planned"  integer      NOT NULL DEFAULT 0,
  "statements_executed" integer,
  "renames_applied"     integer,
  "error_code"          varchar(64),
  "error_message"       text,
  "scope_kind"          varchar(20),
  "scope_slug"          text,
  "summary_added"       integer,
  "summary_removed"     integer,
  "summary_renamed"     integer,
  "summary_changed"     integer
);

CREATE INDEX IF NOT EXISTS "nextly_migration_journal_status_idx"
  ON "nextly_migration_journal" ("status");

CREATE INDEX IF NOT EXISTS "nextly_migration_journal_started_at_idx"
  ON "nextly_migration_journal" ("started_at");

CREATE INDEX IF NOT EXISTS "nextly_migration_journal_source_idx"
  ON "nextly_migration_journal" ("source");

-- DOWN

DROP TABLE IF EXISTS "nextly_migration_journal";
