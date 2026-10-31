---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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

Storage plugins no longer stop the config from loading when their credentials are absent. `vercelBlobStorage()` and `s3Storage()` validated the token, bucket and region inside the factory call, which runs while `nextly.config.ts` is evaluated — so every command refused to start without them, including `generate:types` and the other schema-only commands that never touch storage. The check now happens at the first storage operation (an upload, a read, a delete, at runtime boot or in `nextly media`) and refuses with the same messages as before, so a site running schema-only commands can unset its placeholder `BLOB_READ_WRITE_TOKEN` or S3 variables, and a deployment with real credentials sees no change. `enabled: false` and uploadthing's warn-and-degrade behave exactly as they did.
