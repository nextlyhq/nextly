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

A dashboard card's settings sheet can now draw Collection, Filter, Sort and Group by settings, offering only the collections and fields the reader may read, for widgets whose card query is built from them. Registered widgets cannot declare these settings yet: a registered widget's query applies only `limit`, so registration refuses them, as before. A stored choice the reader can no longer make opens at its default, with a line saying so, and "Reset to defaults" leaves a card's Collection as it is. A widget may mark one setting as quick; the mark is validated now, and the card header that shows it comes later. The workspace payload gains `widgetSources`, and widget source fields gain an optional `groupable: false` mark. New experimental type exports on `nextly/config`: `AnyWidgetSetting`, `ContentSetting` and `PublishedContentSource`.
