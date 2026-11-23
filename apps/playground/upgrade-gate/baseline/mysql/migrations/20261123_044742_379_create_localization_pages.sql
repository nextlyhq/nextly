-- Migration: 20261123_044742_379_create_localization_pages
-- Collections: pages
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"pages","mainTable":"dc_pages","companionTable":"dc_pages_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_pages_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` VARCHAR(255),
  `slug` VARCHAR(255),
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_pages` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_pages_locales`;
