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

A header & footer set opens in the builder. Its row in the Pages panel's Header & footer group, and "Open in builder" on the admin's Header & footer list and in a set's form, open the set on a screen of its own: its header and footer around a grey "Page content goes here" box, with the set's settings in the right panel while nothing is selected. There you change its name, pick its header and footer from menus with pictures (the components marked for that area first, then "Other components", then "None"), see how many pages use it, make it the site default, and rename, duplicate or delete it. Save keeps the change as the set's draft, so pages using it are unchanged; Publish asks "Publish to N pages?" first. The header and footer are selected and edited in place as on a page, and Back returns to the page the set was opened from. A set's row in the Pages panel now opens this screen instead of the set's admin form in a new tab.
