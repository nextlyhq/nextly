-- Migration: 20261123_044715_999_create_localization_posts
-- Collections: posts
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"postgresql","collection":"posts","mainTable":"dc_posts","companionTable":"dc_posts_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255},{"name":"excerpt","kind":"longText"},{"name":"meta_title","kind":"text","length":255},{"name":"meta_description","kind":"text","length":255},{"name":"content","kind":"longText"},{"name":"custom_script","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_posts_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  "slug" TEXT,
  "excerpt" TEXT,
  "meta_title" TEXT,
  "meta_description" TEXT,
  "content" TEXT,
  "custom_script" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_posts" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_posts_locales";
