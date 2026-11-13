-- Migration: 20261113_160809_212_create_localization_announcement
-- Singles: announcement
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"single","spec":{"dialect":"sqlite","collection":"announcement","mainTable":"single_announcement","companionTable":"single_announcement_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"headline","kind":"text","length":255},{"name":"body","kind":"longText"}],"status":true}}

-- UP
CREATE TABLE IF NOT EXISTS "single_announcement_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "headline" TEXT,
  "body" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_announcement" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "single_announcement_locales";
