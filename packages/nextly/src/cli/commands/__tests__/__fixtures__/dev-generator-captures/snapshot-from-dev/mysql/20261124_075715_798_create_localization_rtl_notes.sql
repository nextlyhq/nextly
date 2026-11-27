-- Migration: 20261124_075715_798_create_localization_rtl_notes
-- Collections: rtl_notes
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"mysql","collection":"rtl_notes","mainTable":"dc_rtl_notes","companionTable":"dc_rtl_notes_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"title","kind":"text","length":255},{"name":"heading","kind":"text","length":255},{"name":"note","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS `dc_rtl_notes_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` VARCHAR(255),
  `heading` VARCHAR(255),
  `note` VARCHAR(255),
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_rtl_notes` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `dc_rtl_notes_locales`;
