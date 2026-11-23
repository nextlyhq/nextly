-- Migration: 20261123_044742_385_create_localization_form-submissions
-- Collections: form-submissions
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"form-submissions","mainTable":"dc_form_submissions","companionTable":"dc_form_submissions_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"spam_reason","kind":"text","length":255},{"name":"notes","kind":"longText"},{"name":"ip_address","kind":"text","length":255},{"name":"user_agent","kind":"text","length":255},{"name":"page","kind":"longText"},{"name":"edited_by","kind":"text","length":255},{"name":"title","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_form_submissions_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `spam_reason` VARCHAR(255),
  `notes` TEXT,
  `ip_address` VARCHAR(255),
  `user_agent` VARCHAR(255),
  `page` TEXT,
  `edited_by` VARCHAR(255),
  `title` VARCHAR(255),
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_form_submissions` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_form_submissions_locales`;
