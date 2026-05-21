-- Migration: dynamic_collections_singles_status
-- Generated at: 2026-05-21T12:00:00.000Z
-- Dialect: MySQL
--
-- Mirror of the PostgreSQL dynamic_collections_singles_status
-- migration. See the PG file header for the full why.

-- UP

ALTER TABLE `dynamic_collections`
  ADD COLUMN `status` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `dynamic_singles`
  ADD COLUMN `status` TINYINT(1) NOT NULL DEFAULT 0;

-- DOWN

ALTER TABLE `dynamic_collections` DROP COLUMN `status`;
ALTER TABLE `dynamic_singles` DROP COLUMN `status`;
