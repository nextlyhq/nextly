-- Migration: Email template default attachments
-- Adds a nullable `attachments` JSONB column to email_templates so that
-- templates can carry default media-library attachments that are merged
-- with per-send attachments at send time.

-- UP

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "attachments" jsonb;

-- DOWN

ALTER TABLE "email_templates" DROP COLUMN IF EXISTS "attachments";
