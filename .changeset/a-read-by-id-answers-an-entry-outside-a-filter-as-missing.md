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

A read by id under a collection `read` rule that answers with a filter, through the Direct API, a plugin service or REST, now reads an entry the filter matches and answers one it does not match exactly as an entry that does not exist, where it refused such a caller before. Such a read returns the entry the filter matched, without its pending working draft. A read rule's filter can't name a field inside a component yet: a rule whose filter does is refused, and the refusal is logged once.

A read rule's filter that names a localized field must hold in each language the read may fall back to, so a read never shows a fallback value the rule refuses. A filter on a localized date, a read rule's or a caller's own `where`, now compares the date as the instant it names on every database.
