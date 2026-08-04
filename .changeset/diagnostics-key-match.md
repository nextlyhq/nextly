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

`create-nextly-app` recognises the development-diagnostics setting however an existing `.env`
spells it, and no longer mistakes a different variable for it.

A substring test treated `NEXTLY_DEV_DIAGNOSTICS_BACKUP=1` as the setting already being present,
so such a project was skipped and never told the real one exists. The check now matches an
assignment at the start of a line, including the commented form and the `export KEY=value` form
dotenv accepts so a file can also be sourced by a shell.

The whitespace in that match is confined to the current line. Allowing it to cross newlines made
the scan backtrack across the blank lines an `.env` is full of, which is quadratic on the common
case of a file that does not contain the key at all.
