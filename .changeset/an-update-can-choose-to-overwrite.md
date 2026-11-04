---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

An update can now choose to overwrite. Send `_overwrite: true` with the values, beside the `_rev` you read, and the update is applied whatever the document's current version, on REST, the Direct API and the plugin service alike, single updates, batches and bulk updates by ids or by query included. It needs no permission beyond the update itself, and `_overwrite` is never stored. Any value other than `true` or `false` is refused as a validation error.

Every overwrite is recorded in the document's history, whether or not it keeps versions. When the version sent was out of date, the history names whose changes it replaced ("Overwrote changes by Ben"); with no version, or the current one, it says only that the save was an overwrite. A save whose overwrite cannot be recorded is not kept. `_overwrite` is experimental.
