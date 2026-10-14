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

`create-nextly-app --template plugin` now scaffolds a plugin that installs, tests
and runs as created. The flag accepts every template the interactive prompt
offers, and a plugin scaffold no longer stops at "App Router not detected": its
Next.js app lives in `dev/`, so only the package manager is detected.

The plugin is copied from the template bundled with the CLI, and its Nextly
packages are pinned to that CLI's release, so the two always match; `--local-template`, `--use-yalc` or a
`--branch` other than main still resolve the template live, for `blank` too.
Run from inside a Next.js app, `--template plugin` creates the package in its
own directory instead of installing into the app.

The scaffold now boots on the first `pnpm dev`: `dev/.env` is written from
`dev/.env.example`, the admin page provides the query client its hooks need,
and the dev user named by `admin.devAutoLogin` is created under `next dev`,
so `/admin` opens signed in. The generated test uses the current Direct API,
peer dependencies are always semver ranges (pnpm rejects a dist-tag there),
and `--use-yalc` links `@nextlyhq/plugin-sdk` with the other local packages.
