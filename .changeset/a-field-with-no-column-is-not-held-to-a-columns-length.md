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

A field that makes no column of its own (a field group's field) is no longer refused in the Schema Builder for a name longer than a column may be. The Builder now asks the save's own rule whether a field becomes a column, `fieldProducesColumn`, which `nextly/config` publishes with `usesJunctionTable` (both @experimental). The field picker's `nameProblem` is also told the type picked (`(name, type)`), an additive change to the experimental plugin SDK type. Every field name, column or not, is held to 255 characters, the most a field group's rows can point back to by name: the shared field-name rule refuses a longer one with the new experimental kind `name-too-long` (`FieldNameProblemKind` gains it), and a collection, Single or field group declared in code is refused with `FIELD_NAME_TOO_LONG` by the same cap. A schema template's name check asks the same rule, so a link to several entries, which keeps them in a column of its own, is now held to a column's length there as the save holds it.
