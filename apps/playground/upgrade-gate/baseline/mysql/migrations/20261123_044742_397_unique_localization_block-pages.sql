-- Migration: 20261123_044742_397_unique_localization_block-pages
-- Collections: block-pages
-- Entity scope: touched
-- Generated: localization companion (unique) (i18n)
-- Localization: {"version":4,"kind":"unique","entity":"collection","spec":{"dialect":"mysql","collection":"block-pages","mainTable":"dc_block_pages","companionTable":"dc_block_pages_locales","defaultLocale":"en","parentIdType":"VARCHAR(36)","columns":[{"name":"title","kind":"text","length":255},{"name":"slug","kind":"text","length":255}],"status":false,"unique":[{"field":"slug","column":"slug"}]}}

-- UP
CREATE UNIQUE INDEX `uq_dc_block_pages_locales_slug__locale_1mvq6jl` ON `dc_block_pages_locales` ((SHA2(WEIGHT_STRING(NULLIF(`slug`, '')), 256)), `_locale`);

-- DOWN
DROP INDEX `uq_dc_block_pages_locales_slug__locale_1mvq6jl` ON `dc_block_pages_locales`;
