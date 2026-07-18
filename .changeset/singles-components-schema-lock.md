---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Schema Builder saves for singles and components now reject stale saves.

Applying a schema change to a single or a component through the Schema Builder previously ignored the version the editor was loaded at, so two admins editing the same single or component would silently overwrite each other (last-write-wins on both the DDL and the stored metadata). Both now compare the submitted version against the current one and reject a stale save with a version-conflict error before any DDL runs, matching the collection apply path. All three entity kinds report the conflict identically, so the client can prompt the editor to reload and retry. Code-first schema changes applied through the dev HMR path are unaffected.
