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

A locked area in a localized blocks field, or in a blocks field on a single, now keeps
what that document already stores. Inside a `"contentOnly"` slot a save could already keep
a value its page stored before a block's defaults changed; a translated page now keeps what
its own language stores, never another language's value, and a single keeps what it stores.
Before, both were measured against the starting blocks alone. A language saving its first
value is still measured against the starting blocks.

For plugin field types: the write a validator is handed carries the language it is judged
in (`write.locale`), and `readStored` takes a `locale` and can read a single
(`{ single, field, form }`). A field kept per language reads that language's value, or
`absent` where it stores none. Both additions are experimental, like the rest of the
stored read.
