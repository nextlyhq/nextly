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

Media library fixes: Used in never names what a reader cannot open, Undo never claims to restore
an item already deleted, and a folder delete never moves or removes an item waiting on its Undo.

- `GET /admin/api/media/:id/usage` counts the documents on the page the reader may not open as one
  number, `meta.hiddenCount`, in place of `meta.hidden`, whose list by collection or Single named
  them.
- An item deleted at once (the delete route, a bulk delete, `nextly.media.delete`) while an earlier
  delete's Undo was open is answered by that Undo as already deleted, not restored.
- Deleting a folder while an item in it is being deleted with Undo is refused (409) even when the
  delete with Undo started a moment after the folder was checked, with or without its contents.
- Switching between All media, Missing alt text and Unused, changing folder, searching or filtering
  by type clears the selection, so a bulk delete or move acts only on files on screen.
- Used in reads only the usage rows of the documents on the page, however many Singles use the item.
- A file storage could not remove when a delete with Undo finished stays recorded, and the job that
  finishes the delete removes it once storage takes it.
