-- Migration: 20261123_044742_374_create_localization_posts
-- Collections: posts
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"posts","mainTable":"dc_posts","companionTable":"dc_posts_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255},{"name":"excerpt","kind":"longText"},{"name":"meta_title","kind":"text","length":255},{"name":"meta_description","kind":"text","length":255},{"name":"content","kind":"longText"},{"name":"custom_script","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_posts_locales` (
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
  `excerpt` TEXT,
  `meta_title` VARCHAR(255),
  `meta_description` VARCHAR(255),
  `content` TEXT,
  `custom_script` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_posts` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_posts_locales`;
