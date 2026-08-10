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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Creating a field group through `nextly.fieldGroups.create()` or the mounted `POST /api/field-groups` route now creates its table. Both previously answered success while writing only a registry row, leaving a field group whose storage did not exist and every read and write to it failing.

Those two routes now also refuse a create whose table another field group already owns, which only the admin path checked before. Because a slug is normalised on its way to a table name, two slugs that differ only by hyphens and underscores name one table; such a request used to reach the schema change and rebind the existing field group's storage to the new field list. The mounted route additionally rejects a slug over 50 characters, the bound the rest of the product already validates against, instead of accepting it and provisioning a table under a name the database truncates or refuses.
