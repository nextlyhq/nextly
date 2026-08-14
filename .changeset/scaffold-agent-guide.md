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
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Scaffolded projects now ship an `AGENTS.md` agent guide and a `CLAUDE.md` that
points at it, following the pattern the monorepo uses for itself.

The guide is written for a coding agent picking the project up cold: where the
config and collections live, which commands exist, and the things that surprise
people — that `find()` is loosely typed until `types:generate` runs, that users
are read through their own namespace rather than as a collection, and that
migrations ship one file per dialect.

The generated content sits inside a managed block, so a future regeneration can
replace it without touching notes written above or below it.
