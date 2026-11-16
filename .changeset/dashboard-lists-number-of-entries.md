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

Dashboard lists show their reader's "Number of entries" (the setting formerly "Number of items"), up to 20, whatever the card's size, and load no more than that. Content and Upcoming releases now offer the setting too, as does Forms' "New form submissions", whose footer now reads "View all (N)" when there are more. Needs your attention shows every item, with no "Show N more". `listEntries` and `MAX_WIDGET_ROWS` (now 20) are exported, experimental, from `nextly` and `@nextlyhq/plugin-sdk` for widgets that list; `rowsThatFit` keeps its meaning (at most ten). Saved "Number of items" values are read as saved.
