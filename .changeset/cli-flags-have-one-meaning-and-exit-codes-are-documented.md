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

The CLI's flags now mean one thing on every command, every command's help ends
with its exit codes, and no command waits for an answer it cannot get.

Compatibility, for scripts and CI:

- A deletion declined at the prompt now exits 1 on `migrate:fresh`,
  `migrate:down` and `prune` (it exited 0). A `prune` that cannot be asked (no
  terminal, `CI` set, or `--non-interactive`) and has no consent now exits 1 as
  well; `migrate:fresh` and `migrate:down` already exited 1 there. Give
  `--accept-data-loss` (or `NEXTLY_ACCEPT_DATA_LOSS`) to let it run.
- `--yes` never consents to deleting data. `migrate:fresh --yes` is refused and
  names `--accept-data-loss`.
- `webhooks:prune` and `permissions:cleanup` now take `--accept-data-loss`.
  In this release a run that cannot be asked still deletes and prints a
  notice; from the next release it needs `--accept-data-loss` (or
  `NEXTLY_ACCEPT_DATA_LOSS`). With a terminal they ask. `i18n:restore --purge`
  takes the consent too.
- `nextly db:sync --remove-orphaned` now lists the orphaned tables, registry
  entries and permissions it would delete and takes the data-loss consent
  first: at a terminal it asks, and a no exits 1 with nothing deleted; where
  nobody can be asked it still deletes in this release and prints that the next
  release needs `--accept-data-loss`.
- `nextly migrate:create` with nothing to do exits 0 (it exited 2).
- `nextly generate:types --check` exits 2 when the component map is out of step
  and 1 when it could not check (the two were the other way round).
- A failed `nextly add` exits 1 and names the package manager's own code.
- Retired spellings, honoured for one release with a notice: `migrate:fresh
-f/--force` and `prune --force` (use `--accept-data-loss`), and
  `generate:widget --force` (use `--overwrite`). `db:sync -f/--force`, which
  never did anything, is refused.

New:

- A global `--non-interactive`: never prompt; a command that needs an answer
  stops before changing anything and names the flag that gives it. Prompts are
  also skipped whenever stdin or stdout is not a terminal, or `CI` is set.
  `migrate:create`'s own `--non-interactive` is now this one.
- `db:sync --yes` answers `--promote` / `--demote`'s confirmation. Without a
  terminal, `init` (without `--yes`), `db:sync --promote/--demote` (without
  `--yes`) and `upgrade --reconcile-core` stop with an error of their own
  instead of waiting.
- A misspelt flag or command is refused with the nearest one suggested, on
  every command, `media` and `permissions:cleanup` included.
- Ctrl+C at a prompt of a `nextly` command ends the run with exit 130; it is
  no longer taken as a no. Inside `next dev`, Ctrl+C at a schema prompt still
  cancels only that change and the server keeps running.
