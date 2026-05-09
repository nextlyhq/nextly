-- Migration: Add logo_url column to site_settings

-- UP

ALTER TABLE `site_settings` ADD COLUMN `logo_url` varchar(2048);

-- DOWN

ALTER TABLE `site_settings` DROP COLUMN `logo_url`;
