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

Every command that writes the project folder now offers `--dry-run`, with one
meaning everywhere: show what would change, change nothing.

- `init`, `add`, `build`, `generate:types`, `generate:manifest`,
  `migrate:create` and `migrate:baseline` take `--dry-run`, and so do
  `telemetry enable`, `telemetry disable` and `telemetry reset`.
- A dry run prints one "Would …" line per file it would write or remove, per
  command it would run (`add` prints the install command and installs
  nothing; `--skip-install` keeps its meaning) and per setting it would change,
  then "Dry run: nothing was changed."
- Where the real run would refuse, the dry run says "A real run would refuse:
  …" and still exits 0. It takes no lock and asks no confirmation or consent;
  it still asks questions that decide what would be written, such as `init`'s
  answers and `migrate:create`'s renames.
- `migrate:baseline --dry-run` writes nothing to the database: it names the
  migration file, its snapshot and the ledger row a real run would record.
- `generate:types` and `generate:manifest` keep `--check`, which exits non-zero
  when the files are out of date; `--dry-run` lists the files and exits 0.
- `migrate`, `migrate:down`, `webhooks:prune` and `generate:widget` keep their
  `--dry-run`; its help line now reads the same on every command.
