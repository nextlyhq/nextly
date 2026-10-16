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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

An edit to a published Single's component fields, saved without publishing,
is no longer lost. The working draft never held component values, so the
edit was dropped at the save and the next publish kept the old values. The
draft now holds them, in the same shape a collection's draft does (built on
the live components, a save's changes merged sub-field by sub-field, a list
replaced whole), the save's version records them, and publishing writes
them. A publish that sends its own component values still wins over the
draft's, sub-field by sub-field.

The same draft, and every version a held save records, now holds the Single
as a read returns it. Groups, repeaters and JSON fields are held as values
rather than the text their column stores, so such a version restores
instead of being refused by validation. A localized Single's draft holds
every stored translation of its language, not only the fields the save
named, so a version restores without dropping the others.
