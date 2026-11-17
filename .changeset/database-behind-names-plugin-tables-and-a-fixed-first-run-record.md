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

`nextly migrate` and a production start with migrations at start name two more things a database can be missing. A table or column a plugin's applied migration made and the database has since lost (dropped by hand, or missing after a partial restore) is named with the plugin module that made it, where before the run reported the database up to date. And on a site whose newest migration was written before migrations recorded settings and permissions, a settings-only or permission-only change with no migration is compared with what the database's first `nextly migrate` on this release recorded, which never changes, where before it was compared with the live rows, which a development start or a plugin install rewrites, so a change already made in development went unnamed. New first-run records also keep each app and plugin permission with its owner. A site whose record was written before this release has a permission added since named, and one removed not named, until its next `nextly migrate:create`.
