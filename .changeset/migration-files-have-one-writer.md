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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

One writer of migration files. `nextly migrate:create`, `nextly migrate:baseline` and a Schema Builder save that writes a migration no longer run at once on one project, in any pair, so no two migrations are written from the same snapshot.

Each writer holds the project's migration folder while it reads the newest snapshot and writes, through a file there, `.nextly-writer.lock`, removed when the writer ends. `migrate:create` holds it for the whole command, its questions included. A command that finds the folder held waits about a minute, then stops and names the command holding it. A Schema Builder save made meanwhile is refused at once and can be saved again once the other writer ends. A writer that ended without letting go stops renewing its hold, which lapses after two minutes with nobody clearing it. A writer that stalled past that while another went ahead writes no migration and no snapshot, and says so.

A migration's snapshot and `.sql` file now each appear whole, the snapshot first, so `nextly migrate` never reads half a file or a migration whose snapshot is still to come.

A snapshot counts as the newest only once its migration file is beside it. One left alone, by a writer killed between the two files, is passed over, so the next `nextly migrate:create` still writes the change; `nextly migrate:check` names the leftover snapshot to delete.

A command stopped by a held folder ends with `MIGRATIONS_WRITER_BUSY`, and one that another writer overtook with `MIGRATIONS_WRITER_OVERTAKEN`.

Add `.nextly-writer.lock` to a project's `.gitignore`: it is left in the migration folder only when a writer is killed, and the next writer removes it.
