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

Every card of a default dashboard keeps its own identity. A widget a site's `defaultLayout`
places more than once names an `id` for each further card (`{ widget, id, settings }`), and
startup refuses a repeat without one, or two cards under one id, showing the entry to write. A
row following the default keeps each card's removal and settings under that id.

A declared widget's `shows` is now judged with the settings a reader gave its card, and a save
staged before a card's verdict changed is refused as stale, rather than leaving that card out; a
save that changes such a setting answers with the token the next save is checked against.
An optional `defaultLayout` entry whose widget is not installed no longer counts against the
dashboard's limit. `contributes.dashboard.widgets: null` is refused at startup as not a list.
