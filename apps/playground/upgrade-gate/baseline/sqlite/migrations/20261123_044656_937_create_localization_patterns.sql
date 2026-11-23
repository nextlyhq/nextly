-- Migration: 20261123_044656_937_create_localization_patterns
-- Collections: patterns
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"patterns","mainTable":"dc_patterns","companionTable":"dc_patterns_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"description","kind":"longText"},{"name":"category","kind":"text","length":255},{"name":"keywords","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_patterns_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "description" TEXT,
  "category" TEXT,
  "keywords" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_patterns" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_patterns_locales";
