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

A write that changes more than one language asks its access rule once in each language it changes, and goes ahead only where every answer allows it. A delete is asked in each language its entry holds, so under `delete: ({ locale }) => locale !== "de"` an entry with German content can no longer be deleted, while one with English content alone still can; before, the rule was told no language and allowed both. A delete of several entries, by ids, by query or in a batch, judges each entry by its own languages, and a rule answering a filter in each language deletes only an entry each of those filters matches. An update by query writes the default language and is now asked in it. This holds on the Direct API, a plugin service and REST, where a delete's route now checks the grant and leaves the rule to the delete. An admin screen's delete offer for a collection is a hint, shown where some language allows a delete.
