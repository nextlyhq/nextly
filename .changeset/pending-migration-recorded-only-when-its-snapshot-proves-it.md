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

`nextly migrate` records a pending app migration applied without running it, where the database already stands at its end and not its start, only when its snapshot proves all of it: every statement changes only tables, columns, indexes, constraints and foreign keys (or writes the registry row `migrate:create` wrote with it), its checksum is the one its snapshot recorded, and it has no unresolved attempt. Otherwise the run stops with `MIGRATION_NOT_PROVEN` (exit 2) before running or recording the file, and lists each statement it would have skipped.

**Compatibility — pending files the database already matches.** A pending app migration that was edited, holds a data statement, or changes something its snapshot does not record (a trigger, for example), and whose schema the database already has (for example after `db:sync` on a shared database) is now refused instead of recorded silently. Run the statements it would skip by hand, or confirm they are not needed, and record it with `nextly migrate:resolve --applied <migration>`. A pending file that starts and ends at the same schema (a data-only file, for example) still runs, as it does today.
