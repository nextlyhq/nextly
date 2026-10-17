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

Adding Nextly to an app reads and writes its env files the way Next.js does.

- A `$` in a database URL you type is written as `\$`, so Next.js keeps it instead of expanding it away.
- References such as `$NAME` and `${NAME:-default}` are expanded by dotenv-expand 10.0.0, the version Next.js 16.3 bundles, so a value is read as the app gets it: single-quoted values are expanded too, a default wins over the file's own value, and `${NAME-text}` is left as Next.js leaves it. The app's values never reach the process environment the CLI's own commands inherit.
- A lone carriage return ends a line, and a quote right after a backslash stays inside the value, as dotenv reads them.
- A `DB_DIALECT` read from another variable is treated as unknown, since the environment the app runs in can set that variable differently; no database URL is added beside it. An empty `DB_DIALECT` counts as unset, as the runtime treats it, so the chosen database URL is added.
- `.env`, `.env.example` and `.gitignore` are created exclusively. A file that appears while the generator runs is merged into, and it is checked again first, so a link that appeared is left alone. Only "absent" counts as absent: any other failure to look at a file stops the run.
- In `.env.example`, a credential is flagged even when it contains a placeholder word, when it is the fallback in `${NAME:-value}`, or when it is a `?password=` in the database URL.
- `.env` counts as ignored by git only through a `.gitignore` in its folder or a folder above it inside the repository, not through an excludes file that happens to be named `.gitignore`.
