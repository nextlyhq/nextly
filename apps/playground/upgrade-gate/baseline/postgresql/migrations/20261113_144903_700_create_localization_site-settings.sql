-- Migration: 20261113_144903_700_create_localization_site-settings
-- Singles: site-settings
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"single","spec":{"dialect":"postgresql","collection":"site-settings","mainTable":"single_site_settings","companionTable":"single_site_settings_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"tagline","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "single_site_settings_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "tagline" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_site_settings" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "single_site_settings_locales";
