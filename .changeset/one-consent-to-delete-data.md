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

Deleting data now takes one consent, on every command that does it: `--accept-data-loss` on the command line, or `NEXTLY_ACCEPT_DATA_LOSS` in the environment. It covers the development push and `db:sync` dropping columns, `migrate:down` running a DOWN that loses data, `migrate:fresh`, `prune`, and a full `plugins uninstall`.

Given alone, it covers every deletion of the run, and the run prints each table and column before deleting it. Given a list (`--accept-data-loss=posts,pages.summary`), it covers only those: a named table covers dropping it, dropping any of its columns and removing its rows, and a named `table.column` covers dropping that column. Anything the list leaves out is refused, by name, and nothing changes. At a terminal with no consent, every deletion is listed, with each table's rows and each column's non-empty values, and the command asks. With no terminal and no consent, it refuses at once, changes nothing, and prints the consent that would cover it, where `migrate:fresh` used to wait for an answer nobody could give. `migrate:fresh` deletes every table, so it takes the consent without a list, and `migrate:down` takes it without a list too while it judges a DOWN as a whole.

**Earlier consent spellings** keep working for what each covered before, and say they are deprecated, naming the new spelling: `NEXTLY_ALLOW_CODE_FIRST_DROPS` for the development push and `db:sync`, `--allow-data-loss` for `migrate:down`, `--force` for `prune` and for `migrate:fresh`. Each covers only its own command's deletions; anything else in the same run needs the new consent. Once the new consent is given, it alone decides: an earlier spelling still set beside it is named as ignored, so it cannot widen a list.

**`plugins uninstall --yes` no longer drops tables.** A full uninstall drops the plugin's tables only with the data-loss consent (`--accept-data-loss`, or a list naming its tables); `--keep-data` is unchanged and needs none. A script that uninstalls with `--yes` and no consent now stops, changes nothing, and names the consent that would let it continue.

`nextly prune` with no consent and no terminal still lists the orphaned tables and drops nothing, and now prints the consent that drops them. Each orphan is listed with the archived translations its removal deletes.
