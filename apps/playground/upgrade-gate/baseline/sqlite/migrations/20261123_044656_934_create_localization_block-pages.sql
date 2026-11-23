-- Migration: 20261123_044656_934_create_localization_block-pages
-- Collections: block-pages
-- Entity scope: touched
-- Generated: localization companion (create-only) (i18n)
-- Localization: {"version":1,"kind":"create-only","entity":"collection","spec":{"dialect":"sqlite","collection":"block-pages","mainTable":"dc_block_pages","companionTable":"dc_block_pages_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255}],"status":false}}

-- UP
CREATE TABLE IF NOT EXISTS "dc_block_pages_locales" (
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
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_block_pages" ("id") ON DELETE CASCADE
);

-- DOWN
DROP TABLE "dc_block_pages_locales";
