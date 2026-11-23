-- Migration: 20261123_044656_947_create_localization_landing-page
-- Singles: landing-page
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"single","spec":{"dialect":"sqlite","collection":"landing-page","mainTable":"single_landing_page","companionTable":"single_landing_page_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "single_landing_page_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_landing_page" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "single_landing_page_locales";
