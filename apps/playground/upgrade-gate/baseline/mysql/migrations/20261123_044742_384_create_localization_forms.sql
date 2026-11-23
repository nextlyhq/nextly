-- Migration: 20261123_044742_384_create_localization_forms
-- Collections: forms
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"forms","mainTable":"dc_forms","companionTable":"dc_forms_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"name","kind":"text","length":255},{"name":"description","kind":"longText"},{"name":"closed_message","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_forms_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `name` VARCHAR(255),
  `description` TEXT,
  `closed_message` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_forms` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_forms_locales`;
