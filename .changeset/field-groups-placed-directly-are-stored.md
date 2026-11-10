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

A field group placed directly in another field group's fields is now stored, read and removed at every depth. Its values were refused before, with "not stored", and the admin left the field out of the form. Each level is a row of its own field group's table, pointing at the row of the instance that holds it. It is validated by its own rules, a required one is required, passwords in it are hashed, its fields' read and write rules apply, its translated values are kept per language, version restores and media usage include it, and deleting or clearing an instance removes everything placed in it. The Builder's form draws it, and the configuration no longer warns about it.

A filter path that goes past a field group's own fields (`hero.cta.label`) is refused as a field that cannot be filtered on. It used to be read as a column named after the whole path, which answered with the wrong rows.

A plugin's write to a field-group row nested more than eight levels deep now still expires its document's cached reads, and an entity's teardown reads only the field-group tables that can hold its rows below the first level.
