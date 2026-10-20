---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

A project runs on the version of pnpm or Yarn that made it.

- A new project records `"packageManager": "<name>@<version>"` from the command that launched `create-nextly-app`, before its first install, so Corepack runs the version you chose rather than its own default. `yarn dlx create-nextly-app` on Yarn 4.9.2 used to install with Yarn 1.22.22.
- Adding Nextly to an existing app records the same, and says so, only when the app chooses no package manager yet and the one installing is the one that launched the CLI. An app that sets `packageManager` or `devEngines.packageManager`, a member of a workspace, and an app reached through another package manager are left as they are.
- npm, Bun, and a launcher that names no exact version record nothing.
