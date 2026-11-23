-- Migration: 20261123_044656_945_create_localization_form-submission-resends
-- Collections: form-submission-resends
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"form-submission-resends","mainTable":"dc_form_submission_resends","companionTable":"dc_form_submission_resends_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"notification","kind":"text","length":255},{"name":"requested_by","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_form_submission_resends_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "notification" TEXT,
  "requested_by" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_form_submission_resends" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_form_submission_resends_locales";
