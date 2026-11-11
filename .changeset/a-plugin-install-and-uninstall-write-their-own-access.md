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

`nextly plugins install` now adds the permissions and roles the plugin declares and sets every preset role's grants, with the record of the Nextly release that set them, as `nextly migrate` from the same release does, in the same transaction that records the plugin installed. A plugin a production start serves therefore has its access whether or not a `nextly migrate` follows, and an install that stops part-way, or cannot set the preset grants, records nothing. `nextly plugins uninstall`, with or without `--keep-data`, marks the plugin's permissions as no longer declared in the transaction that records it uninstalled, keeping every grant and logging the roles that hold each; installing it again clears the marks. A `nextly migrate` run with an uninstalled plugin still in the configuration no longer declares that plugin's permissions again, so their marks and grants stay as the uninstall left them; a plugin with no install or uninstall recorded is declared as before. In production, both commands refuse before changing anything when run from a Nextly release older than the one that set the preset grants, naming the release to run them from.
