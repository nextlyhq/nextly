---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

An app migration whose last attempt stopped or failed part-way, on MySQL or in a file marked `-- nextly:no-transaction`, now stops `nextly migrate`, the boot migrate step and `migrate:down` before they change anything, where before only `nextly migrate` stopped on it and `migrate:down` ran a stopped down section again. The refusal names the file and judges each of its statements from the database as it stands: done, not done, or unknown for a statement whose effect the schema cannot show (one that writes rows, say). Finish the file by hand or reverse what ran, then record which with `nextly migrate:resolve`. An unresolved attempt at a file the build no longer has is refused on every dialect, since the build cannot tell how it ran; `migrate:resolve --failed-cleanup` clears it once what ran is reversed. A down section that stopped or failed this way (one `migrate:down` left behind, before this release too) now also stops `nextly migrate` and the boot migrate step: if you reversed what of it ran, `migrate:resolve --failed-cleanup` now clears it and the migration stays applied; if you finished it, `migrate:resolve --rolled-back` records the rollback.

**Upgrading.** After upgrading, a site whose migration history holds an old failed attempt at a migration file the project no longer has stops applying migrations. The site keeps serving: its startup log says `Boot migrations failed: …` and names the file with an unresolved attempt, and `nextly migrate` exits with a failure that names it too. A failed migration record from before this release can also stop it for a file the project still has, when that file has changed since the attempt (or the record holds no checksum matching it). To go on, run `nextly migrate:resolve --failed-cleanup <file>` for each file the message lists, or `nextly migrate:resolve --applied <file>` if that migration fully ran. `--failed-cleanup` needs no file and changes no schema.
