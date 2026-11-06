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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Super-admins can add a System health card to the dashboard: the running Nextly version, whether migrations are applied, and whether storage is working.

- Three lines, always drawn: Version ("Nextly 0.0.2-alpha.66"), Migrations ("Up to date", "N pending" while boot migrations apply, or "Failed") and Storage ("Working", or "Last write failed 5m ago" with a short reason and the adapter). A line the answer did not settle, missing or with a status the admin does not know, reads "Couldn't check", never healthy. Each line leads with its severity by shape as well as colour: a check, a triangle, "!" in a filled circle, or "?" in an outlined circle, named in words for assistive technology.
- Migrations read "Failed" when a migration has an apply or a rollback that failed or never finished and nothing has resolved since, the same standing `nextly migrate:status` reads (so a failed `migrate:down` of an applied migration counts), or a collection's last schema change failed or was interrupted (still open ten minutes after it started), with a link to resolve each: the migrations guide, or the collection in the Schema Builder.
- Each problem is judged by its own migration's or collection's records, however many newer events the ledger holds.
- Each problem also appears in Needs your attention as a critical "System problems" item: a migration's says to run `nextly migrate:status` to see which, and a schema change's or storage's links the Schema Builder's collections or the media library.
- Only super-admins are offered the card, may place it or see its problems; nobody else is told it exists.
- The storage layer now records its last failed server-side write, an upload, a delete or a bulk delete (when, the adapter's type, and a reason chosen from a fixed set, never the adapter's error message) and clears it on the next successful write. The record is kept per process and in memory: a restart or another instance does not see it.
