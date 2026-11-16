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

`create-nextly-app` can run without prompts, keeps a connection string out of sight, and reports its own version.

- New flags: `--database-url <url>` (or `--database-url -` to read it from standard input, keeping a password out of shell history and the process list), `--package-manager npm|pnpm|yarn|bun` and `--no-git`.
- Without a terminal, a run that is missing an answer stops before writing anything and names every flag it needs; `--yes` takes the defaults.
- The connection string is written only to the ignored `.env` (the example file keeps a placeholder) and is never printed: the prompt is masked, and errors show the host only.
- `--package-manager` installs with that manager and pins its exact version in `packageManager` (none for npm or Bun). An existing app installed with another manager is refused.
- `--version` reports the package's release, and a misspelt flag or value is refused with the nearest one suggested.
