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

A block can now say where each of its settings is edited. `PropSchema` gains three experimental hints: `group` (the tab: content, style or advanced; content by default), `section` (the section inside it, in plain words; on Style, one of the Style tab's sections), and `code` (what the setting writes, shown beside a select's options). Registration refuses a setting placed where it can't be right, naming the block and the setting: what the block says outside Content, a tab that doesn't exist, text, media, an address, a relation or a list in Style, and a Style setting without a Style section. The builder's inspection groups a block's settings by tab and section, and nothing in the panel looks different yet. `showOptionValue` is removed; the built-in HTML tag setting uses `code` instead. The plugin SDK re-exports the new `PropGroup` and `StyleSectionKey` types.
