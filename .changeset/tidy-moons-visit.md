---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/plugin-form-builder": patch
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

A hook that throws after the write has committed no longer fails the write.

`afterCreate`, `afterUpdate` and `afterDelete` run once the row is durable, and
a throw there reported the operation as failed with no entry returned. Callers
could not learn the id of the row that existed, and a retry wrote it a second
time. These phases now report their failures instead of raising them: the
operation succeeds, the error is logged with its phase and collection, and the
remaining handlers still run. `beforeCreate` and the other pre-write phases are
unchanged -- refusing a write is what they are for.
