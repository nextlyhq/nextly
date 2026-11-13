-- Migration: 20261113_144903_702_create_localization_seo
-- Field groups: seo
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"fieldGroup","spec":{"dialect":"postgresql","collection":"seo","mainTable":"comp_seo","companionTable":"comp_seo_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"meta_title","kind":"text","length":255},{"name":"meta_description","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "comp_seo_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "meta_title" TEXT,
  "meta_description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "comp_seo" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "comp_seo_locales";
