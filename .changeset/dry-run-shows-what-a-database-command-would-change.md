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

More commands that write the database take `--dry-run`: show what would
change, change nothing. Each opens the database read-only, asks no
confirmation or data-loss consent, and exits 0, naming the real run's refusal
where it would refuse.

- `prune --dry-run` lists every table it would drop, in the words the consent
  uses, and still reports a collection something depends on.
- `permissions:cleanup --dry-run` names each permission it would delete with
  its grants.
- `migrate:fresh --dry-run` names every table it would drop and each migration
  it would run again (and the seeders with `--seed`).
- `migrate:resolve --dry-run` runs the same checks and names the ledger rows it
  would record.
- `i18n:restore --dry-run` counts the translation rows it would write, the
  archived values it would claim and, with `--purge`, those it would delete.
- `users:create-admin --dry-run` runs the checks without taking the setup
  claim and names the account it would create.
- `setup-token --dry-run` names the replacement and prints no token.
