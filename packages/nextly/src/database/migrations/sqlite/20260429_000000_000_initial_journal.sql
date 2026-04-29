-- Migration: initial_journal
-- Generated at: 2026-04-29T00:00:00.000Z
-- Dialect: SQLite
-- Source: F11 (file-based migration ledger). Bundled with the nextly package
-- so fresh production databases get the table on first `nextly migrate`.
-- Synthetic 000000_000 time component so this bundled file sorts BEFORE
-- any user-generated migration created on the same date.

-- UP

CREATE TABLE IF NOT EXISTS "nextly_migrations" (
  "id"           TEXT PRIMARY KEY,
  "filename"     TEXT NOT NULL UNIQUE,
  "sha256"       TEXT NOT NULL,
  "applied_at"   INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "applied_by"   TEXT,
  "duration_ms"  INTEGER,
  "status"       TEXT NOT NULL CHECK ("status" IN ('applied', 'failed')),
  "error_json"   TEXT,
  "rollback_sql" TEXT
);

CREATE INDEX IF NOT EXISTS "nextly_migrations_applied_at_idx"
  ON "nextly_migrations" ("applied_at");
