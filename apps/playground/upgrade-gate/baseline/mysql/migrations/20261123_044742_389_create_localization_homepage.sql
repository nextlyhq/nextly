-- Migration: 20261123_044742_389_create_localization_homepage
-- Singles: homepage
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"single","spec":{"dialect":"mysql","collection":"homepage","mainTable":"single_homepage","companionTable":"single_homepage_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"title","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `single_homepage_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` VARCHAR(255),
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `single_homepage` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `single_homepage_locales`;
