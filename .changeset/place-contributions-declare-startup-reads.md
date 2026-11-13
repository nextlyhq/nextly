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

A part a plugin adds to an admin place can now name the reads it makes as it opens, with `startupReads` (experimental), the same declaration a plugin page takes. Its paths may name the place's ids in braces (`/templates/entry-designs?collection={collection}&entry={entryId}` at `collection.edit`), which the page fills in, URI-component encoded, from its address. The page starts these reads as it first renders, beside its own reads, under the key `usePluginRoute` reads, so the part's first read takes the started one and sends no request of its own. Boot refuses more than four reads, a path the admin could not ask for, or an id the place does not give, naming the plugin, the contribution and the path.

An entry's and a Single's editor now wait for their claim on the document, and for those reads, before they are drawn, for 250 ms at most: a colleague's "being edited" banner and a plugin's side panel section are drawn with the editor instead of pushing the fields and the panel's sections down as they land. The Page Builder's Design section declares its read, so it no longer moves Status, Publishing and Details 202 px down after the editor appears.
