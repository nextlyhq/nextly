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

A publish that also edits a group, repeater or JSON field no longer fails validation.

When a pending change existed, publishing it together with an edit to any group, repeater or JSON field was refused as "must be an object", with no field rules involved at all. The ordinary write encodes those fields to their column strings before the publish is judged, and the check on the document being published then read a group as text. Both checks now read the document in its logical shape, through the same conversion that reads the live row, and the write encodes it once.

A field declared inside a group or a repeater is judged as content, however it is named.

The publish gate skips the store's own bookkeeping columns, such as `id` and `updatedAt`, and defers to the field names the schema declares so that a real field with one of those names is still judged. Those names were collected in a way that stopped at the first named container, so a declared field nested inside a group or repeater was still skipped, and a Single's publish was not given the names at all. The names are collected at every depth now, for collections and Singles alike.
