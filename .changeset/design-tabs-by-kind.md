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

The page builder's Design panel is laid out by kind: four tabs, Colours, Type, Spacing and Styles. Type holds the site's fonts, the type sizes, and the font and weight variables. Spacing holds spacing, radius and shadows, with an "Other values" group at its end, shown only when it has something in it. Styles holds the block and shared styles. Each group's heading folds it and shows how many it holds, and a folded group stays folded for that author across reloads, while a new author finds every group open. One search, under the tabs, looks across the variables of every tab and shows beside each tab name how many matches it holds; clearing it brings back the groups that were folded. A Design tab remembered from before opens on Colours.
