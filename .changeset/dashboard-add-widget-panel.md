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

The dashboard's Add widget now opens a panel beside the dashboard. It lists every widget you may add in core's groups (Overview, Team, Plugins), with the cards you removed first so they can be put back where they were. You can search it by name, description, category, group or plugin (a removed card by its name), and add several cards in one visit: each new card goes to the end of the dashboard and is ringed so you can see where it landed. A one-card widget already placed shows as on the dashboard. At the card limit, adding is turned off and putting a removed card back still works. The panel announces search counts and each card it adds. When it closes, focus goes to the last card added, or back to Add widget.

The layout read now gives each widget the panel offers a `rank`, its place in that order, so the panel can list a placed widget where it would be offered.
