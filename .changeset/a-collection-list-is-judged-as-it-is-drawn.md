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

A collection list's query is now judged at save exactly as the page draws it and the editor offers it.

- A list inside another list's "When empty" state shows the related entries of the item around that list, never of an entry the outer list did not find. The editor's Source menu offers the same.
- A list of "this entry's" related entries is refused on a Single, whose page has no entry, and the editor says so.
- A list's fields are judged in the language being saved, and the editor offers the fields visitors can see in the language being edited.
- A filter or sort on a field the editor never offers is refused: a time of day, rich text or media, or a sort on a related entry.
- A filter on a number field compares with a number, on every operator.
- A list inside a placed component is judged as the page composes it, so a placement's value or variant cannot sort or filter it by a field visitors can't see.
- The canvas reads any sort a list may store, however long.

Pages already stored keep saving: a problem a stored page already had stays a warning.
