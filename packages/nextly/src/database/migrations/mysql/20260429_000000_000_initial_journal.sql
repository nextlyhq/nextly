-- Migration: initial_journal
-- Generated at: 2026-04-29T00:00:00.000Z
-- Dialect: MySQL
-- Source: F11 (file-based migration ledger). Bundled with the nextly package
-- so fresh production databases get the table on first `nextly migrate`.
-- Synthetic 000000_000 time component so this bundled file sorts BEFORE
-- any user-generated migration created on the same date.

-- UP

CREATE TABLE IF NOT EXISTS `nextly_migrations` (
  `id`           VARCHAR(36) PRIMARY KEY,
  `filename`     VARCHAR(512) NOT NULL UNIQUE,
  `sha256`       CHAR(64) NOT NULL,
  `applied_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `applied_by`   VARCHAR(255),
  `duration_ms`  INTEGER,
  `status`       VARCHAR(20) NOT NULL CHECK (`status` IN ('applied', 'failed')),
  `error_json`   JSON,
  `rollback_sql` TEXT,
  INDEX `nextly_migrations_applied_at_idx` (`applied_at`)
);
