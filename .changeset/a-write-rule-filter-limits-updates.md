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

A collection's `update`, `publish` and `unpublish` access rules may answer a filter instead of `true`. A write through the Direct API or a plugin service, by a signed-in user or an API key, then changes an entry only if it matches the filter. An entry outside the filter is left as it was and refused: with a 403 where the caller may read it, and as a missing entry (404) where it may not. The entry is matched under the write's lock, and a write inside the caller's own transaction is matched in that transaction.

A write that changes an entry's data must leave it matching every filter that judged it. An update that would move the entry out of its filter is refused with a 403 and changes nothing, and so is a publish that would promote a held edit doing the same. A filter on a translated field is matched in the language being written.

Over REST, for the bulk and batch writes, and for a publish or unpublish of every language at once, an update, publish or unpublish rule's filter is still refused, as before.
