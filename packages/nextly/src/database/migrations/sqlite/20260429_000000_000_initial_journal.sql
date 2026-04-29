-- Migration: initial_journal
-- Generated at: 2026-04-29T00:00:00.000Z
-- Dialect: SQLite
-- Source: F11 (file-based migration ledger). Bundled with the nextly package
-- so fresh production databases get the table on first `nextly migrate`.

-- UP

CREATE TABLE IF NOT EXISTS "nextly_migrations" (
  "id"           TEXT PRIMARY KEY,
  "filename"     TEXT NOT NULL UNIQUE,
  "sha256"       TEXT NOT NULL,
  "applied_at"   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  "applied_by"   TEXT,
  "duration_ms"  INTEGER,
  "status"       TEXT NOT NULL CHECK ("status" IN ('applied', 'failed')),
  "error_json"   TEXT,
  "rollback_sql" TEXT
);

CREATE INDEX IF NOT EXISTS "nextly_migrations_applied_at_idx"
  ON "nextly_migrations" ("applied_at");
