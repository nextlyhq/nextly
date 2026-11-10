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

A production start no longer compares the configuration with the live schema.
It used to read every collection's table on each start through `getNextly()`
to look for drift, and every core table on each start, to warn about core
columns, core tables and retired auth tables or image sizes, and the indexes of
each translated collection with a field marked unique, to warn that one was
missing. Those reports are now a development start's (`NODE_ENV` set to `development`). Run
`nextly migrate` before serving: it brings the core tables up to date and
names what it finds.

A production start still names the rules left in the retired `access_rules`
column of the registry tables, which this release no longer enforces, and
still refuses a database laid out for the other choice of
`experimental.perLanguageStorage`.

A dry run names each file from the project folder with `/` between its parts on every operating system, Windows included.
