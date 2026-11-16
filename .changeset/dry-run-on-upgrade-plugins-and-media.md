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

`--dry-run` on `upgrade`, `plugins install`, `plugins uninstall` and
`media reindex-usage`: show what would change, change nothing. Each opens the
database read-only, takes no lock, asks no confirmation or data-loss consent,
and exits 0, naming the real run's refusal where it would refuse. `db:sync` is
now the only command that writes by default without `--dry-run`.

- `upgrade --dry-run` counts each step's pending work, all counts taken before
  any step runs, and names a refusal such as a backup nobody can confirm.
- `upgrade --reconcile-core --dry-run` names each statement the reconcile's
  push would run, and each table or column drop it leaves in place.
- `plugins install --dry-run` names each pending module with what it deletes,
  the owner rows set back to active and the record made; with `--all`, a
  plugin is planned as if the installs before it had run.
- `plugins uninstall --dry-run` names each module's DOWN, what it drops (none
  with `--keep-data`) and the records made.
- `media reindex-usage --dry-run` names the usage record it would replace and
  the collections, Singles and email templates it would read, without booting
  the app.
- Plugin hooks (`onInstall`, `onUninstall`) are not run by a dry run, which
  says so.

`upgrade --reconcile-core` now asks to confirm only the destructive changes it
will make. A core reconcile never drops one of Nextly's own tables or columns,
so such a drop is reported as left in place instead of asked about, and with
nothing else destructive to make it asks nothing, even without a terminal.
