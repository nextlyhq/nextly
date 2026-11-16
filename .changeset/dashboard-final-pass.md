---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

A final pass over the dashboard at phone, tablet, laptop and desktop widths, in light and dark. Every control on it is now at least 24 by 24 pixels, so it is easy to tap: the card footers' links ("View all", "Details", "All users"), the Content card's names and draft counts, a note's links and the settings drawer's "Reset to defaults". A card with nothing in its footer no longer keeps an empty line under its content. A long card title next to a header control, such as "Continue where you left off" beside Mine and Team on a phone, wraps onto the header's second line instead of being cut short. In Customize, cards are drawn with the stronger control border, and on a touch screen the resize edge is shown without needing a hover. A card in the right-hand column can now be widened from its edge: taking the edge past the grid's right edge widens the card to its widest width. The settings drawer's short choices (Width, Number of entries, Row spacing) are one bordered row with the chosen option filled, and the Title field's hint reads "Leave empty to use the name shown." Team cuts a long role name short, with the whole name on hover, so the person's name keeps its room. A note's links are drawn in the text's own colour, underlined. In System health's Details, the report keeps phrases such as "24 h" and "3 locales (en, es, ar)" on one line where it wraps, without changing the text it copies, and a toast said while Details is open stands above its footer instead of over the Copy diagnostics button.
