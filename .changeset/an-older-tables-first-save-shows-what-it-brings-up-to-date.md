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

An older table's first Schema Builder save now shows what it brings up to date, and saves once confirmed. The first save of a collection, Single or field group whose table an earlier Nextly version made also converts that table, which the server writes only when the save confirms it. The preview now names each conversion (`conversions`, each with a plain-words `change` such as "adds an index on created_at"). The save's review lists them under "Brought up to date", and its Save confirms them (`acknowledgedConversions`), where before the review showed the short confirmation and the save was refused. The refusal and the review's line now read, for example: "dc_posts was made by an earlier Nextly version. This save brings it up to date: changes body from text to varchar(255)."
