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

A production start reads the stored schema version once again. It reads the version just before it loads its definitions, so that the first schema follow after the start loads nothing again; it then compared the database's version with the build's by reading the same row a second time. The comparison now uses that reading, or the one after boot migrations where they stored a new version, and reads the row itself only where this process marked a change since.

A reload of the definitions keeps the fields the configuration declares, as the start does. Where an entity's registry row predates its configuration, the start registers the configuration's definition over the row's, but a reload (the Direct API's first schema-version follow, the reload after boot migrations) loaded the row's narrower definition alone, so a declared field the table holds was no longer served, and one the database was not migrated for was no longer reported as not migrated. Every reload now registers the configuration's entities after the rows, through the start's own step, from the configuration as it now stands: a config reload under `next dev` makes the configuration it applied the one later reloads register.
