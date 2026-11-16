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

Team activity no longer reads as though a whole collection was deleted. A row names the entry by its title when it carries one ("Ana deleted Spring launch announcement"), and otherwise says "an entry in" the collection ("Ana deleted an entry in Posts"); a Single without a name is "a Single". A row carries no title when the entry has none, or when the entry no longer exists, so a title the reader may not be told is never shown and never called empty. Settings changes keep naming what they changed, and legacy settings activity rows now arrive with `subjectKind: "settings"`: a row on `GET /dashboard/activity` or from the `system:activity` source that was recorded before the kind was, under a settings namespace, said `null` and now says `"settings"`.
