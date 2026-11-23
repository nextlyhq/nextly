-- Migration: 20261123_044656_942_create_localization_form-submissions
-- Collections: form-submissions
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"form-submissions","mainTable":"dc_form_submissions","companionTable":"dc_form_submissions_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"spam_reason","kind":"text","length":255},{"name":"notes","kind":"longText"},{"name":"ip_address","kind":"text","length":255},{"name":"user_agent","kind":"text","length":255},{"name":"page","kind":"longText"},{"name":"edited_by","kind":"text","length":255},{"name":"title","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_form_submissions_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "spam_reason" TEXT,
  "notes" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "page" TEXT,
  "edited_by" TEXT,
  "title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_form_submissions" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_form_submissions_locales";
