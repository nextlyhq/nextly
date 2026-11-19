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

A Builder save that stops part way on MySQL, where each schema change commits as it runs, now keeps what applied and records it. The save's migration file and snapshot hold exactly the changes the database took, recorded applied; the definition and the registry describe that shape; and the save's failure lists each change it asked for, by field, as applied or not applied (`data.changes`). Saving again finishes the rest. This covers a collection's, a Single's and a field group's Builder apply and the Single schema save. A save whose stop cannot be judged from the live table (a translated entity, one with several migration files, or relationship tables and keys of its own) keeps its files for `nextly migrate:resolve`, as before, and so does a collection's update through the development push.
