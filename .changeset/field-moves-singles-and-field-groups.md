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

A field moved into a group, or out of one, in the Schema Builder now keeps its values on a Single and in a field group, as it already does in a collection. A field group's move reaches every entry of every collection and Single that uses the group. A save with moves is refused, with nothing written, when it would also need a direct apply, when it is made outside development, or when it moves a field that keeps a value for each language, which is not available yet.

The checks a collection's moves take apply here too: every moved value is judged against its new column before the save and again by the file on the database it runs on, and a move is refused while a working draft holds a value at the field's old place (a field group's every working draft is searched). A Single's media-use paths move with its fields. The dialog's questions, on these dialogs and on a collection's, ask no drop of a column a move carries into a group and offer no rename from it.
