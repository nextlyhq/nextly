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

Plugins can read the stored form of a document's fields and write a field only if it is unchanged, through two new `@experimental` exports of `@nextlyhq/plugin-sdk`.

`readStoredFields(identity, { ...document, fields, form, locale })`, where the document is `{ collection, id }` or `{ single }`, returns the values as stored, for the live row (`form: "published"`) or the working draft a preview shows (`form: "draft"`), in one language, with no `afterRead` hook of the collection or of a field and no population. It reads fields of a plugin field type stored as JSON, and refuses any other, and any field a field-level read rule governs. The person must be able to read the collection or Single; the draft form also needs them to be able to update the document.

`updateIfUnchanged(identity, { ...document, data, locale, expect })` makes the ordinary update as that person, under access rules. `expect` names a field, the form it was read in and `storedValueHash` of the value read. The update reads the field again inside its own transaction once it holds the entry's row lock (`SELECT ... FOR UPDATE` on PostgreSQL and MySQL; SQLite's write transaction already serializes writers), and is refused with a `CONFLICT` error, changing nothing, when the value no longer hashes to what was read. With `noPendingDraft: true` it is refused as well when a working draft is pending, which a publish would otherwise put live. The expectation names a top-level field: one inside a named group is refused with `INVALID_INPUT`, because an update writes the group's whole value. The read, and the update gate for the draft form, are judged in the language read, as ordinary reads are. A `published` read whose live row, in the language read, is in a state the workflow does not call public answers `absent` unless the person may update the document, as an ordinary read would not show it to them. The live row's state and its values are read in one snapshot. The read resolves its language once, as an ordinary read does (a language the site does not configure reads as the default), and refuses a selector such as `all`.
