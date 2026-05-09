-- Migration: Email template default attachments
-- Adds a nullable `attachments` TEXT column (JSON-serialized) to
-- email_templates so that templates can carry default media-library
-- attachments that are merged with per-send attachments at send time.

-- UP

ALTER TABLE `email_templates` ADD COLUMN `attachments` text;

-- DOWN

ALTER TABLE `email_templates` DROP COLUMN `attachments`;
