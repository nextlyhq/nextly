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

The dashboard's Needs attention and Create cards are offered exactly when they would have something to show, and the Content card's rows always say what they are.

- **Needs attention** is offered on content it could count: a collection or Single with a published source, or releases. A reader whose only collection is mid-migration, and who may not read releases, is no longer given a card that can only say "not available".
- **Create** is offered only when it would offer a collection: one the reader may create in that does not turn creating off (`admin.disableCreate`, as form submissions do). A site whose only writable collection is form submissions no longer gets an empty Create card.
- **`system:content`** keeps each row's `kind` whatever a query selects, so a collection and a Single that share a slug always stay apart.
