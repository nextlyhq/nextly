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

A hook that throws in a post-commit phase (`afterCreate` / `afterUpdate` / `afterDelete`) now reports the failure to the caller instead of only to the server log. The write still reports success, because the row is durable and a side-effect phase cannot change it, but the mutation response carries a `warnings` array naming the phase, the collection, and the error code so an integration can react to a side effect that did not run. The field is present only when something failed, so an ordinary response is unchanged, and it appears on both the REST mutation envelope and the Direct API's `MutationResult`.
