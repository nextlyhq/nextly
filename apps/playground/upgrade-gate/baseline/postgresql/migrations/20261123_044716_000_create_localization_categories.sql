-- Migration: 20261123_044716_000_create_localization_categories
-- Collections: categories
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"postgresql","collection":"categories","mainTable":"dc_categories","companionTable":"dc_categories_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255},{"name":"description","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_categories_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  "slug" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_categories" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_categories_locales";
