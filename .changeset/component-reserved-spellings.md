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

Reject a field named `id`, `createdAt` or `updatedAt` in a Field Group (component), through both
the Visual Schema Builder and `defineFieldGroup`. A component keeps its values in a table of its own
carrying those columns, so such a field is emitted into the same `CREATE TABLE` as the injected one
and the database refuses the statement. The name is now refused where it is chosen, with a message
saying which system column it collides with.

Field groups that already declare such a field could never have had a working table, since creating
it fails; they will now be reported at configuration time instead of during schema application.
