-- Migration: 20261113_144908_612_create_localization_announcement
-- Singles: announcement
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"single","spec":{"dialect":"mysql","collection":"announcement","mainTable":"single_announcement","companionTable":"single_announcement_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"headline","kind":"text","length":255},{"name":"body","kind":"longText"}],"status":true}}

-- UP
CREATE TABLE IF NOT EXISTS `single_announcement_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `headline` VARCHAR(255),
  `body` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `single_announcement` (`id`) ON DELETE CASCADE
);

-- DOWN
DROP TABLE `single_announcement_locales`;
