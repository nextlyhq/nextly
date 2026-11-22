---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A Section's padding can now be Compact, Normal or Roomy, from **Style › Spacing**, above
the spacing box. Normal is the padding Sections have today. Compact is tighter above and
below and Roomy is airier; the sides stay the same. The sizes come from the site's spacing,
so changing a preset's variable in **Design › Spacing** moves every Section using that
preset. When a side has a value of its own, the control reads "Custom". Choosing a preset
clears those values, and one undo brings them back.

Design's Spacing tab lists four more variables next to "Section padding": "Section padding,
compact (top and bottom)", "Section padding, compact (sides)", "Section padding, roomy (top
and bottom)" and "Section padding, roomy (sides)". They start at 24–40px and 72–120px top
and bottom, and 16–32px at the sides.

Compatibility: every site's stylesheet declares the four new variables
(`space.section-y-compact`, `space.gutter-compact`, `space.section-y-roomy`,
`space.gutter-roomy`). A Section left at Normal stores nothing new, and its markup and
stylesheet are unchanged. A Compact or Roomy Section stores `paddingPreset`, and the page
compile writes its padding as that Section's own default. The Section's own values and
its block styles still win over the preset. `@nextlyhq/blocks-engine` exports
`PADDING_PRESET_PROP`, `PADDING_PRESETS` and `paddingPresetTokensOf` (experimental). A
style trace's block-type origin may name the one `node` it was written for.
