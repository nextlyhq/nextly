-- Migration: initial_journal
-- Generated at: 2026-04-29T00:00:00.000Z
-- Dialect: PostgreSQL
-- Source: F11 (file-based migration ledger). Bundled with the nextly package
-- so fresh production databases get the table on first `nextly migrate`.
-- Synthetic 000000_000 time component so this bundled file sorts BEFORE
-- any user-generated migration created on the same date.

-- UP

CREATE TABLE IF NOT EXISTS "nextly_migrations" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "filename"     TEXT NOT NULL UNIQUE,
  "sha256"       CHAR(64) NOT NULL,
  "applied_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "applied_by"   TEXT,
  "duration_ms"  INTEGER,
  "status"       TEXT NOT NULL CHECK ("status" IN ('applied', 'failed')),
  "error_json"   JSONB,
  "rollback_sql" TEXT
);

CREATE INDEX IF NOT EXISTS "nextly_migrations_applied_at_idx"
  ON "nextly_migrations" ("applied_at");
