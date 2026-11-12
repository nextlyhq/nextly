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

Statuses on the dashboard are drawn in the admin's status colours, the same in light and dark. A chart of statuses, in Breakdown and in `Widget.BarChart`, draws Published in the success colour, Scheduled in the info colour, Changes in the warning colour, and Draft and Archived in the muted ink, so a status reads the same on a chart as beside it. The severity marks in Needs your attention and a card's error icon use the status's solid colour, the exported `StatsCard`'s trend is a quiet chip with a coloured arrow, and the exported `ContentStatusWidget` draws Published and Draft in their status colours. The widget documentation recommends the status tokens and `Badge`'s status variants to widgets that draw their own component.
