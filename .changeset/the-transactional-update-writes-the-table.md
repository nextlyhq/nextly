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
"@nextlyhq/plugin-form-builder": patch
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

A transaction's `update` is built by the adapter, the way its `insert` already was, so it writes the columns the physical table has rather than the ones the runtime model declares.

The main UPDATE of every collection entry was a hand-built SQL string in the mutation service, because the typed `tx.update` went through the Drizzle query builder and the builder drops any key naming a column the runtime model does not declare — without a word. One write depends on exactly such a column: the localization transition window, where `localized` has been flipped on a collection, the runtime model has moved its translatable columns to a companion table that does not exist yet, and the default locale must keep writing the physical main table until it does. The transactional INSERT already reached that column because every adapter builds it itself. This is the UPDATE half of the same rule, so the mutation service now makes the same `tx.update` call every other update makes, and the raw statement is gone from product code.

What changes for a caller of `tx.update`:

- A column the model declares binds exactly as before — through that column's own encoder, so dates, JSON documents and booleans reach the driver as the bytes the query builder sent. Existing callers see no difference on the wire.
- A column the model does not declare is written to the physical table, bound the way that adapter's transactional insert binds every value.
- A key naming no column on the table is a SQL error from the database, where the query builder silently dropped it. This surfaced one: the transaction and batch update path passed `updatedAt` for a dynamic table whose column is `updated_at`, so those writes never bumped the timestamp; they do now.
- A key whose value is `undefined` is not written — JSON's meaning of an absent key, and what the query builder already did. For the collection entry update this is a change: the raw path bound `undefined` as SQL NULL, so an own `undefined` from a server caller or a hook cleared the column. `null` still clears it.
- An update that names nothing to write is refused by name (`No values to set`), as the query builder refused it.
- The pooled `update` is unchanged.
