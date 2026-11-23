-- Migration: 20261123_044742_386_create_localization_form-submission-sends
-- Collections: form-submission-sends
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"form-submission-sends","mainTable":"dc_form_submission_sends","companionTable":"dc_form_submission_sends_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"send_key","kind":"text","length":255},{"name":"notification_name","kind":"text","length":255},{"name":"state","kind":"text","length":255},{"name":"retired_by","kind":"text","length":255},{"name":"requested_by","kind":"text","length":255},{"name":"resend","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_form_submission_sends_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `send_key` VARCHAR(255),
  `notification_name` VARCHAR(255),
  `state` VARCHAR(255),
  `retired_by` VARCHAR(255),
  `requested_by` VARCHAR(255),
  `resend` VARCHAR(255),
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_form_submission_sends` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_form_submission_sends_locales`;
