-- Migration: 20261122_061613_142_unique_localization_notes
-- Collections: notes
-- Entity scope: touched
-- Generated: localization companion (unique) (i18n)
-- Localization: {"version":4,"kind":"unique","entity":"collection","spec":{"dialect":"postgresql","collection":"notes","mainTable":"dc_notes","companionTable":"dc_notes_locales","defaultLocale":"en","parentIdType":"TEXT","columns":[{"name":"slug","kind":"text","length":255},{"name":"value","kind":"text","length":255}],"status":false,"unique":[{"field":"slug","column":"slug"}]}}

-- UP
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_notes_locales_slug__locale_1mvq6jl" ON "dc_notes_locales" (NULLIF("slug", ''), "_locale");

-- DOWN
DROP INDEX IF EXISTS "uq_dc_notes_locales_slug__locale_1mvq6jl";
