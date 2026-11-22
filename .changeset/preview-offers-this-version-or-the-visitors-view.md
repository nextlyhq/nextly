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

Preview in the page builder is now a split button. Pressing **Preview** previews this version, saving a draft first when there is unsaved work (never publishing). Its arrow opens a menu with **Preview this version** ("Saves a draft first" while there is unsaved work) and **Preview as visitor** ("Hides blocks whose conditions don't match"), which replaces the "Apply conditions" switch that sat above the canvas. While it is on, a strip above the canvas reads "Previewing as a visitor", says what was hidden, and offers **Stop**. Where it can't be used (no block has conditions, a component or a Layout part, or no entry to check against) it is listed disabled with the reason. It is the author's own for the session and changes nothing stored.
