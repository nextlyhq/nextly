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

A field group's field rules now decide its fields on every write, as the collection's or Single's own field rules decide theirs: a create, an update (over REST, the Direct API, inside a caller's transaction and in a bulk create), a Single update, the publish of a held draft and the restore of a version. On create a field the writer may not set is not stored. On update it keeps its stored value: an instance sent with its id is judged as an update and keeps what it held, and one sent without an id is a new instance, judged as a create. A field group inside a group or repeater keeps its stored values the same way. A publish whose pending change edits a field-group field the publisher may not write is refused, naming the field, as one editing the entry's own field is. Trusted server code (`overrideAccess`) still writes every field.

A field rule that refuses an update to a collection's or Single's own field nested in a group keeps that field's stored value, as a refused top-level field does.

A scoped API key's limits now apply to a Single's own field rules on update, as they already did to a collection's: the key is judged by its own grants, not by its owner's.
