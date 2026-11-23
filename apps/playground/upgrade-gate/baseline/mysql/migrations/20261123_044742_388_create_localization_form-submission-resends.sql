-- Migration: 20261123_044742_388_create_localization_form-submission-resends
-- Collections: form-submission-resends
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"form-submission-resends","mainTable":"dc_form_submission_resends","companionTable":"dc_form_submission_resends_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"notification","kind":"text","length":255},{"name":"requested_by","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_form_submission_resends_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `notification` VARCHAR(255),
  `requested_by` VARCHAR(255),
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_form_submission_resends` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_form_submission_resends_locales`;
