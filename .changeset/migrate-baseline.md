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

Add `nextly migrate:baseline`, the step that adopts a database which already exists. A project developed with `db:sync` has real tables and no migration history, so its first `migrate:create` diffed the config against nothing and emitted CREATE TABLE for the whole schema — a file that could never be applied, because the database matched neither the empty baseline it assumed nor the target it described. Baselining records where the history begins, and the next `migrate:create` emits only what changed.

It writes a real migration alongside the snapshot rather than only a marker, so a new environment, CI, or `migrate:fresh` can still build the schema from the history alone, and records it as applied in the same command so it never re-runs against the database it was taken from.

The drift error now recognises this case. A database standing before the history started is not drift, and the three recoveries offered for drift all fail on it, so it names the cause and points at the one command that works.
