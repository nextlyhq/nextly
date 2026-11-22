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

Untranslated entries and Singles work again with every installation keeping its
translatable fields per language.

- Discarding the pending change of an entry or Single that is not translated
  now removes all of it. An edit to a shared field (a page's content or Layout,
  a number, a relationship) is held apart from the text fields, and a discard
  left that part pending, so the editor still showed unpublished changes.
- An update that goes live answers with the whole entry in the language
  written. It used to leave out every text field the update did not name, such
  as the title, and a cache tag for a declared slug was read from the same
  incomplete row.
- A read inside a plugin's transaction that checks a missing translations
  table no longer aborts that transaction on PostgreSQL.
