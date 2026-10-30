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

A collection field with a camelCase name, created or changed through the API
or the Direct API, keeps its name, and its column is the snake_case form the
write path uses (`metaTitle` → `meta_title`), as with code-first collections.
Before, the name itself was lowercased on save (`metaTitle` became the field
`metatitle`), so every write to the field as declared failed with "no column
named meta_title".

- Existing collections keep their fields where they are: an update sending a
  field that differs from a stored one only in case, or that names the same
  column, keeps the stored name, so a field stored lowercased keeps its
  column and values. Renaming such columns to the snake_case form is not done
  here.
- Field names are checked by the column they become: two names that become
  one column (`metaTitle` and `meta_title`), a name whose column is a system
  column (`createdAt`), and a column longer than 63 characters are refused.
- A camelCase field's `min`, `max` and `minLength` constraints are created on
  its column.
- A collection created through the API or Direct API with camelCase field
  names is edited through the API: the Schema Builder refuses camelCase names,
  its own and in its manifest.
