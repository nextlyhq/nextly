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

The plugin scaffold's own test could time out on a first run.

`plugin.test.ts` boots a real Nextly instance in `beforeEach`, building a DI
container, registering the plugin's schema and running auto-sync against a real
SQLite database. Its vitest config stated no budget, so it inherited the
defaults: 5 seconds for the case and 10 for the hook, both sized for a unit test
that touches none of that.

A boot is about a second and a half on a warm machine, and the first run of a
freshly scaffolded project is the least warm moment there is: a cold install, no
build cache, whatever else the laptop or CI container is doing. It is also the
first command a new plugin author runs, so a timeout there reads as a broken
scaffold rather than a tight budget.

Both budgets are now 30 seconds, matching what this repository's own integration
lane gives a suite that boots.
