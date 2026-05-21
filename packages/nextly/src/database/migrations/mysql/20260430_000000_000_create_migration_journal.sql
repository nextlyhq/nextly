-- Migration: create_migration_journal
-- Generated at: 2026-04-30T00:00:00.000Z
-- Dialect: MySQL
--
-- Mirror of the PostgreSQL create_migration_journal migration. See
-- the PG file header for the full why; column shape mirrors
-- packages/nextly/src/schemas/migration-journal/mysql.ts minus the
-- `batch` column added by the next migration (20260501_journal_batch).

-- UP

CREATE TABLE IF NOT EXISTS `nextly_migration_journal` (
  `id`                  VARCHAR(36)   NOT NULL PRIMARY KEY,
  `source`              VARCHAR(20)   NOT NULL,
  `status`              VARCHAR(20)   NOT NULL DEFAULT 'in_progress',
  `started_at`          DATETIME(3)   NOT NULL,
  `ended_at`            DATETIME(3),
  `duration_ms`         INT,
  `statements_planned`  INT           NOT NULL DEFAULT 0,
  `statements_executed` INT,
  `renames_applied`     INT,
  `error_code`          VARCHAR(64),
  `error_message`       TEXT,
  `scope_kind`          VARCHAR(20),
  `scope_slug`          VARCHAR(255),
  `summary_added`       INT,
  `summary_removed`     INT,
  `summary_renamed`     INT,
  `summary_changed`     INT
);

CREATE INDEX `nextly_migration_journal_status_idx`
  ON `nextly_migration_journal` (`status`);

CREATE INDEX `nextly_migration_journal_started_at_idx`
  ON `nextly_migration_journal` (`started_at`);

CREATE INDEX `nextly_migration_journal_source_idx`
  ON `nextly_migration_journal` (`source`);

-- DOWN

DROP TABLE IF EXISTS `nextly_migration_journal`;
