---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Field types now say which validation rules apply to them, in one place.

The schema builder used to decide which rules to offer from lists of built-in
type names it kept itself. A plugin-contributed field type is in none of those
lists, so it was offered no validation rules at all. A plugin type now inherits
the rules of the built-in type its declared storage behaves as, so a field type
shipped by a plugin gets length or numeric rules without anyone editing the
admin.

Length and row counts are now whole numbers of zero or more, so a minimum
length of -5 or 2.7 can no longer be saved. Each control also gets a unique id,
so two field editors open at once no longer share one, which previously left a
label pointing at the wrong input.
