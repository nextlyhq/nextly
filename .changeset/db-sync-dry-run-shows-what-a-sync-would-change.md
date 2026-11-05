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

`nextly db:sync` takes `--dry-run` in every form: show what would change,
change nothing. It opens the database read-only, takes no schema lock, asks
no confirmation or consent, and exits 0, naming the real run's refusal where
it would refuse.

- `db:sync --dry-run` names each table and column operation the schema push
  would run, and each question it would ask, with a note on what it does not
  show; `--remove-orphaned` adds the tables it would delete.
- `db:sync --promote <slug> --dry-run` shows the snippet it would append and
  the registry row it would remove.
- `db:sync --demote <slug> --dry-run` shows the registry record it would write.
- `--dry-run` cannot be combined with `--watch`.

Fixes:

- `db:sync --promote` of a collection defined in code is refused before it
  appends anything to `nextly.config.ts`; it used to append the snippet and
  then be refused.
- `nextly migrate` stopped because a migration file changed after its
  deletions were judged now reads as `PLAN_CHANGED_AFTER_CONSENT` rather than
  an unexpected error.
