---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The page builder now records which pages, components, patterns, Layouts and Singles use each Design variable, and new routes answer how widely a variable is used (counting the shared styles whose own styles name it, and the block types whose default styles name it) and where. A variable that something still uses can no longer be removed: the new remove route and any save of the site style that drops it (the Variables panel's save, an undo, an import) are refused with the places that use it. The stored pages are read again before a removal, in every language and as their pending drafts, rather than trusting a count of zero, and once more after it: a page saved meanwhile that uses the variable puts it back. A removal refused both for a use and for something else (a lock, uses that could not all be counted) is now a conflict naming every reason, for shared styles too, so the in-use code marks only uses. A page save that adds a reference to a variable the site does not define is refused, in a blocks field inside a group too; a reference the page already held still saves.

The variable index lives in a new plugin table, `page_builder__token_usage`, created by the plugin's next migration (schema version 9), and the usage backfill fills it on an existing site. `rebuildPageBuilderUsageIndexes` now requires `tokenIndex`, that index's store, beside `classIndex` and `componentIndex`.
