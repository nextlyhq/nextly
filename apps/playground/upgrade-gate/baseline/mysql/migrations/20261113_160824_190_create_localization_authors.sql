-- Migration: 20261113_160824_190_create_localization_authors
-- Collections: authors
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"authors","mainTable":"dc_authors","companionTable":"dc_authors_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"bio","kind":"longText"},{"name":"job_title","kind":"text","length":255}],"status":true}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_authors_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `bio` TEXT,
  `job_title` VARCHAR(255),
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_authors` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_authors_locales`;
