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

A project's migration history is checked as one line. Each new migration's snapshot records the migration it was written from (`parent`) and any other branch ends it was written with (`merges`), and migrations written without each other, from the same earlier one, are refused with `MIGRATION_HISTORY_FORKED`, naming the files, by `nextly migrate`, a production start, `nextly migrate:check` and a Schema Builder save, until a migration records them together. `nextly migrate` applies nothing further meanwhile. A pending migration that creates a table an earlier one of the same run has made is recorded as applied where the table stands as it would leave it, its indexes included, so a recorded merge of two added collections applies.

This changes what happens after two branches that each added a migration are merged: before, both were applied in file order and the configuration was then refused as ahead. Now nothing is applied until `nextly migrate:create --name record_merge` has written the migration that records the merge; `nextly migrate` then applies all of them. Where both branches change the same table or column, the message names it and says to delete one of the two and write its change again instead, since the two cannot be applied one after the other. Run `nextly migrate:check` in CI to catch it on the pull request.

It is also what stops a duplicate from a `migrate:create` that was stopped for longer than its hold on the migration files while another ran: both files may be written, and neither is applied. `nextly migrate:create` then finds nothing to record and names the one to delete.

A blank migration (`nextly migrate:create --blank`) now states the migration it was written after in its header, since it has no snapshot, and two written without each other are refused in the same way; `nextly migrate:create --blank --name record_merge` records them.

Migrations written before this release record no parent and are never refused; neither is a snapshot copied by hand for a hand-written migration, nor a migration whose parent was removed from the folder.

A writer's hold on the migration files, renewed while another writer was taking it over, is now put back on file systems without hard links too.
