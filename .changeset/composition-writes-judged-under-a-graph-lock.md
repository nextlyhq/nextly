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

Two page builder saves made at once can no longer each pass against the composition graph as it stood before the other. Every write that changes a blocks value is judged again inside its own transaction, after it is stored, while it holds a lock on the graph: no component loop, the composed nesting and depth of the document, and for a component the documents placing it. A second writer waits at the lock until the first commits, and is then judged against what the first stored; a write refused there is rolled back whole. Writes to collections without a blocks field, and writes leaving their blocks unchanged, never wait on it. The lock is a row of the plugin's own options table, locked by the write on PostgreSQL and MySQL; SQLite already runs one writer at a time.

A write made inside a transaction its caller opened at a snapshot isolation (MySQL's default) that started before another write held the lock is refused as a conflict, to be saved again, rather than judged against a graph it cannot see.

Plugins: an in-transaction handler is now handed `readStored(fieldType, target)`, the stored read a field type's validator has, on the write's transaction and scoped to field types the plugin contributes, and `fieldPaths(fieldType)`, the written document's fields of that type (`@experimental`). A collection write that runs in-transaction handlers, and a batch of creates, now read committed on MySQL as they already did on PostgreSQL, so a handler that waits on a row lock reads what committed before it took it.
