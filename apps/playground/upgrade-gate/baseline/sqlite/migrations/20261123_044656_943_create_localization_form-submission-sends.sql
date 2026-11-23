-- Migration: 20261123_044656_943_create_localization_form-submission-sends
-- Collections: form-submission-sends
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"form-submission-sends","mainTable":"dc_form_submission_sends","companionTable":"dc_form_submission_sends_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"send_key","kind":"text","length":255},{"name":"notification_name","kind":"text","length":255},{"name":"state","kind":"text","length":255},{"name":"retired_by","kind":"text","length":255},{"name":"requested_by","kind":"text","length":255},{"name":"resend","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_form_submission_sends_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "send_key" TEXT,
  "notification_name" TEXT,
  "state" TEXT,
  "retired_by" TEXT,
  "requested_by" TEXT,
  "resend" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_form_submission_sends" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_form_submission_sends_locales";
