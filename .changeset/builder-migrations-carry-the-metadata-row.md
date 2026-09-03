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

A collection built in the Schema Builder now survives the deploy.

The migration that path writes created the table and nothing else. That file is
committed and replayed against a database that has never seen the Builder, where
the `dynamic_collections` row it writes locally does not exist -- so production
got the table and no row at all, and the collection was absent from the admin
rather than merely showing a stale status.

The migration now carries the row too, built by the same builder `migrate:create`
uses rather than a second statement that would have to agree with it. The two
committed migration is the only thing replayed against the target database, so
it has to be self-sufficient: nothing else recreates the registry row there.
