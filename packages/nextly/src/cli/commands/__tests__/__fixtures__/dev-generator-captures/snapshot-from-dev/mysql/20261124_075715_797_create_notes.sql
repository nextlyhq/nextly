-- Migration: create_notes
-- Collections: rtl_notes
-- Entity scope: touched
-- Settings: rtl_notes: added
-- Generated at: 2026-11-24T07:57:15.797Z
-- Dialect: MySQL

-- UP
CREATE TABLE `dc_rtl_notes` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `slug` varchar(255) NOT NULL
);
CREATE UNIQUE INDEX `idx_dc_rtl_notes_slug` ON `dc_rtl_notes` (`slug`);
CREATE INDEX `idx_dc_rtl_notes_created_by` ON `dc_rtl_notes` (`created_by`);
CREATE INDEX `idx_dc_rtl_notes_created_at` ON `dc_rtl_notes` (`created_at`);

-- DOWN
DROP TABLE `dc_rtl_notes`;
