-- Migration: Add sidebar customization columns to site_settings

-- UP

ALTER TABLE `site_settings` ADD COLUMN `logo_url_dark` varchar(2048);
ALTER TABLE `site_settings` ADD COLUMN `custom_sidebar_groups` text;
ALTER TABLE `site_settings` ADD COLUMN `plugin_placements` text;

-- DOWN

ALTER TABLE `site_settings` DROP COLUMN `plugin_placements`;
ALTER TABLE `site_settings` DROP COLUMN `custom_sidebar_groups`;
ALTER TABLE `site_settings` DROP COLUMN `logo_url_dark`;
