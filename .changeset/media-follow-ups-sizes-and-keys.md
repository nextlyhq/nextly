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

Media fixes for libraries upgraded from before image sizes were removed, and the bulk dialogs.

- A folder deleted with its contents removes the size files of every item it deletes, an item moved
  into the folder as the delete began included.
- Deleting an item removes a size recorded by its URL alone where the media storage configured now
  serves it there, and names any other in the log by its URL, rather than leaving it unnamed.
- `nextly media remove-sizes` and the check `nextly media orphans` makes before each batch compare
  stored keys exactly on a storage that keeps them as written (S3 and other object storage), so a
  size whose key differs from another file's only in spelling (`media//x.webp`) is removed rather
  than kept with nothing naming it. Local disk and Vercel Blob still read both spellings as one.
- A bulk delete or move dialog closes when the library's folder, view, search or type changes,
  rather than staying open over the cleared selection.
