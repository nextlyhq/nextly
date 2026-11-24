-- Migration: 20261124_075708_579_create_localization_rtl_notes
-- Collections: rtl_notes
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"rtl_notes","mainTable":"dc_rtl_notes","companionTable":"dc_rtl_notes_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"heading","kind":"text","length":255},{"name":"note","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_rtl_notes_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "heading" TEXT,
  "note" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_rtl_notes" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_rtl_notes_locales";
