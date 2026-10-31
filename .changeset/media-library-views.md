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

The media library gains views beside its folders, a Used in list, a delete that can be undone, and
Replace.

- Beside the folders: All media, Missing alt text and Unused, each with its count, and every folder
  with its own. A view lists its items across every folder, with the same search, filter, sort and
  paging. Until `nextly media reindex-usage` has run, Unused says the record is still being built
  instead of listing items content may still use.
- An item's details say where it is used: each document the person may open, as a link, with its
  collection or Single, the fields that use the item and the languages when only some do, and how
  many more they cannot open. `GET /admin/api/media/:id/usage` answers it.
- Delete lists where an item is used before asking, then takes it out of every list and count at
  once and offers Undo for ten seconds, one Undo for a bulk delete. The item, its files, folder and
  usage stay until the window ends; then it is deleted with its files, by the server even if the
  person has left the page. `POST /admin/api/media/deletions` and `/deletions/undo` take a list of
  ids and need the delete permission. The existing `DELETE` routes still delete at once.
- Replace file stores a new file under the same item: the same id, name, alt text, caption, folder
  and usage, with a new address and thumbnail, so every document using it shows the new file. The
  focus point is cleared. A page cached with the old address shows a broken image until it is
  rebuilt. `POST /admin/api/media/:id/replace` answers it, with the upload's own checks.
