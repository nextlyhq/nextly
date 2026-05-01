-- Migration: journal_batch
-- Generated at: 2026-05-01T00:00:00.000Z
-- Dialect: SQLite
-- Source: Phase 5 (Task 24). Adds the `batch` sentinel column to
-- nextly_migration_journal so audit queries can distinguish HMR/dev
-- pushes (batch < 0) from production migrations (batch >= 0). The
-- pipeline sets -1 for source="code" and leaves the default 0 for
-- everything else. Synthetic 000000_000 time component sorts this
-- file before any user-generated migration on the same date.

-- UP

ALTER TABLE "nextly_migration_journal" ADD COLUMN "batch" INTEGER NOT NULL DEFAULT 0;

-- DOWN

-- Note: SQLite supports DROP COLUMN since 3.35.0 (Mar 2021). F17
-- minimum is 3.38, so this is safe.
ALTER TABLE "nextly_migration_journal" DROP COLUMN "batch";
