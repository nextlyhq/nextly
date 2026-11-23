-- Migration: 20261123_044716_007_create_localization_layouts
-- Collections: layouts
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"postgresql","collection":"layouts","mainTable":"dc_layouts","companionTable":"dc_layouts_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"description","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_layouts_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_layouts" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_layouts_locales";
