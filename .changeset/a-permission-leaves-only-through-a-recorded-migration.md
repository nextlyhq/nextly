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

A permission is now marked as no longer declared only by `nextly migrate`, as it applies the recorded migration whose snapshot drops it: an app permission, or a plugin's permission whichever writer added it, for each owner the migration's snapshot or the one before it records (for the first migration after the registry record, each plugin the registry baseline held). Every grant of it is kept and the log names the roles holding it; a later migration that declares it again clears the mark. A plugin a migration knows nothing of keeps its permissions, Nextly's own are never marked, and a snapshot without the registry metadata or the permissions marks nothing. No server start marks a permission any more, in production or in development: a build that stops declaring a permission, an older one included, leaves it as it is.
