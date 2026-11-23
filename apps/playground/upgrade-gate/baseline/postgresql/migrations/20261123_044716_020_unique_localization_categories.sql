-- Migration: 20261123_044716_020_unique_localization_categories
-- Collections: categories
-- Entity scope: touched
-- Generated: localization companion (unique) (i18n)
-- Localization: {"version":4,"kind":"unique","entity":"collection","spec":{"dialect":"postgresql","collection":"categories","mainTable":"dc_categories","companionTable":"dc_categories_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255},{"name":"description","kind":"longText"}],"status":false,"unique":[{"field":"slug","column":"slug"}]}}

-- UP
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_categories_locales_slug__locale_1mvq6jl" ON "dc_categories_locales" (NULLIF("slug", ''), "_locale");

-- DOWN
DROP INDEX IF EXISTS "uq_dc_categories_locales_slug__locale_1mvq6jl";
