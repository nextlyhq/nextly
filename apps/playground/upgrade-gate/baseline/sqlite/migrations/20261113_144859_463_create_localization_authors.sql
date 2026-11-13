-- Migration: 20261113_144859_463_create_localization_authors
-- Collections: authors
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"authors","mainTable":"dc_authors","companionTable":"dc_authors_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"bio","kind":"longText"},{"name":"job_title","kind":"text","length":255}],"status":true}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_authors_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "bio" TEXT,
  "job_title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_authors" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_authors_locales";
