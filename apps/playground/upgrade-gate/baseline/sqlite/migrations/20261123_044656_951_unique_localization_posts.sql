-- Migration: 20261123_044656_951_unique_localization_posts
-- Collections: posts
-- Entity scope: touched
-- Generated: localization companion (unique) (i18n)
-- Localization: {"version":4,"kind":"unique","entity":"collection","spec":{"dialect":"sqlite","collection":"posts","mainTable":"dc_posts","companionTable":"dc_posts_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255},{"name":"excerpt","kind":"longText"},{"name":"meta_title","kind":"text","length":255},{"name":"meta_description","kind":"text","length":255},{"name":"content","kind":"longText"},{"name":"custom_script","kind":"longText"}],"status":false,"unique":[{"field":"slug","column":"slug"}]}}

-- UP
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_posts_locales_slug__locale_1mvq6jl" ON "dc_posts_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';

-- DOWN
DROP INDEX IF EXISTS "uq_dc_posts_locales_slug__locale_1mvq6jl";
