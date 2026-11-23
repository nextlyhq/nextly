-- Migration: 20261123_044716_015_create_localization_landing-page
-- Singles: landing-page
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"single","spec":{"dialect":"postgresql","collection":"landing-page","mainTable":"single_landing_page","companionTable":"single_landing_page_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "single_landing_page_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_landing_page" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "single_landing_page_locales";
