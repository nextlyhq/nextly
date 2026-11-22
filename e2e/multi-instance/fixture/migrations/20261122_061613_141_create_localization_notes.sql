-- Migration: 20261122_061613_141_create_localization_notes
-- Collections: notes
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"postgresql","collection":"notes","mainTable":"dc_notes","companionTable":"dc_notes_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"slug","kind":"text","length":255},{"name":"value","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_notes_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "slug" TEXT,
  "value" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_notes" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_notes_locales";
