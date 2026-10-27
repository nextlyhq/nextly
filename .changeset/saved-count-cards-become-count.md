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

Saved count and health cards are now Count cards. A dashboard that holds a collection's count card, its health card, or both shows one Count card set to that collection, at the first card's place and the widest width Count allows. A Count card already set to that collection takes them in.

This happens as each layout is read, for that reader, and rewrites no stored row. A card whose collection the reader may not read stays as it was, withheld, and converts once they may read it. A card for a deleted collection is kept and shows as not available.

Three dashboard conditions are also corrected:

- Create is no longer offered while it cannot be told which collections turn creating off. The collection definitions it needs come from the read every dashboard request already makes, rather than a second read of every definition.
- The onboarding step and the Create card now share one create decision per collection.
- Needs attention is offered on a readable Single whether or not it has a widget source.
