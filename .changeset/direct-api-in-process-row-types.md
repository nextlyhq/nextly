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

The Direct API types a row the way the process sees it: a timestamp is the Date the driver decoded, not the formatted string a REST response carries. Codegen records which fields a collection or single stores in a timestamp column, and the wire types are unchanged.

A write returned an undecoded row on the raw-SQL paths, so a created row carried epoch numbers on SQLite where a fetched one carried Dates. Every raw-SQL row now decodes the way a read does.

The media services name the error code they mean rather than leaving the boundary to infer one from a status, so a folder-name clash keeps saying "already exists" instead of "reload".
