---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Internal modules and services for reusable field structures now use field-group naming. This renames three container keys reachable through the exported `getService()`: `componentRegistryService`, `componentSchemaService` and `componentDataService` become `fieldGroupRegistryService`, `fieldGroupSchemaService` and `fieldGroupDataService`. The old keys are not aliased, so a call using one no longer resolves. The field group schema service also drops `generateSchemaCode()`, an unused generator that was reachable through that same accessor. Stored data, table names, config keys and HTTP routes are unchanged.
