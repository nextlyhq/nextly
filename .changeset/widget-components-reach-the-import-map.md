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

The generated admin component import map now imports the component each
widget declared under `contributes.dashboard` draws with, and exports the
list of component paths it registers as `registeredComponentPaths`, so what
a map holds can be read without running it.

A plugin widget in today's shape that declares `minSize` and `maxSize` is now
offered only the widths between them; before, every width was offered.

A `list` or `table` example, or answer, whose `fields` are not columns
(`name`, and optionally `label` and `type`) is refused, as its rows already
were.

Startup now stops, with a message to start again, when the collections or
Singles registry cannot be read on a database that is set up, rather than
admitting declared widgets it has not checked. A fresh database still starts
so `/setup` can run.
