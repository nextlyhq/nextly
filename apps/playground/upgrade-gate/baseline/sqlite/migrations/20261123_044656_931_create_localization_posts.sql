-- Migration: 20261123_044656_931_create_localization_posts
-- Collections: posts
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"posts","mainTable":"dc_posts","companionTable":"dc_posts_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255},{"name":"excerpt","kind":"longText"},{"name":"meta_title","kind":"text","length":255},{"name":"meta_description","kind":"text","length":255},{"name":"content","kind":"longText"},{"name":"custom_script","kind":"longText"}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_posts_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
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
