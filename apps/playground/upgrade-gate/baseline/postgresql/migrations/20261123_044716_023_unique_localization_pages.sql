-- Migration: 20261123_044716_023_unique_localization_pages
-- Collections: pages
-- Entity scope: touched
-- Generated: localization companion (unique) (i18n)
-- Localization: {"version":4,"kind":"unique","entity":"collection","spec":{"dialect":"postgresql","collection":"pages","mainTable":"dc_pages","companionTable":"dc_pages_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255}],"status":false,"unique":[{"field":"slug","column":"slug"}]}}

-- UP
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_pages_locales_slug__locale_1mvq6jl" ON "dc_pages_locales" (NULLIF("slug", ''), "_locale");

-- DOWN
DROP INDEX IF EXISTS "uq_dc_pages_locales_slug__locale_1mvq6jl";
