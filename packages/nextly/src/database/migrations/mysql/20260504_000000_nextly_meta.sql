-- Migration: nextly_meta runtime flags table
-- Generated at: 2026-05-04T00:00:00.000Z
-- Dialect: MySQL
-- Source: Sub-task 2A — dashboard seeding card.
-- A small key/value/timestamp store for runtime state that doesn't belong
-- in collection schemas (first consumer: seed.completedAt / seed.skippedAt
-- flags read by the admin dashboard's SeedDemoContentCard).

-- UP

CREATE TABLE IF NOT EXISTS `nextly_meta` (
  `key`        varchar(191) PRIMARY KEY NOT NULL,
  `value`      json,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX `nextly_meta_updated_at_idx` ON `nextly_meta` (`updated_at`);

-- DOWN

DROP TABLE IF EXISTS `nextly_meta`;
