-- Migration: 20261123_044742_395_unique_localization_categories
-- Collections: categories
-- Entity scope: touched
-- Generated: localization companion (unique) (i18n)
-- Localization: {"version":4,"kind":"unique","entity":"collection","spec":{"dialect":"mysql","collection":"categories","mainTable":"dc_categories","companionTable":"dc_categories_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255},{"name":"description","kind":"longText"}],"status":false,"unique":[{"field":"slug","column":"slug"}]}}

-- UP
CREATE UNIQUE INDEX `uq_dc_categories_locales_slug__locale_1mvq6jl` ON `dc_categories_locales` ((SHA2(WEIGHT_STRING(NULLIF(`slug`, '')), 256)), `_locale`);

-- DOWN
DROP INDEX `uq_dc_categories_locales_slug__locale_1mvq6jl` ON `dc_categories_locales`;
