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
  paging. Unused lists an item only when no document uses it and no avatar or logo keeps its
  address. Its list says whether the usage record it read was complete, and the page shows it only
  when that same answer says so: until `nextly media reindex-usage` has run, or while a rebuild runs
  during the read, Unused says the record is still being built instead of listing items content
  may still use.
- An item's details say where it is used: each document the person may open, as a link, with its
  collection or Single, the fields that use the item that the person may read, and the languages
  when only some do, and how many more they cannot open. A field a read rule withholds from the
  person is never named. A translation the person cannot read shows neither its fields nor its
  language. `GET /admin/api/media/:id/usage` answers it. Until `nextly media reindex-usage` has run,
  Used in and the delete dialog never say an item is unused.
- Delete lists where an item is used before asking, then takes it out of every list and count at
  once and offers Undo for ten seconds, one Undo for a bulk delete. The item, its files, folder and
  usage stay until the window ends; then it is deleted with its files, by the server even if the
  person has left the page or the server restarted (a job queued with the delete finishes it
  through the jobs queue), every item of a large delete included. Up to 1,000 items
  (`MEDIA_DELETE_LIMIT`, exported from `nextly/config`) are deleted in one request, all of them or
  none; a larger selection is refused before you confirm. `POST /admin/api/media/deletions` and
  `/deletions/undo` take a list of ids and need the delete permission. The existing `DELETE`
  routes still delete at once. A folder holding an item inside its Undo window cannot be deleted,
  with or without its contents, until that window has passed: the request answers 409.
- Undo brings back only what that delete marked, never an item another delete was already
  removing, and offers it for the whole of those items' own window: an item already waiting keeps
  its own, earlier deadline, which the answer's `deleteAfter` gives, while `markedDeleteAfter`
  gives this delete's own. Each item is judged against its own deadline, so an Undo of several
  items brings back every one still inside its window and lists the rest as already deleted; an
  Undo after an item's deadline is refused for that item. If a database statement fails part way,
  the Undo is rolled back and brings back none of them.
- Replace file stores a new file under the same item: the same id, name, alt text, caption, folder
  and usage, with a new address and thumbnail, so every document using it by id (upload fields,
  block documents, attachments) shows the new file at once. Rich text, a JSON field, a block
  document or any other value naming the file by its address (`src` or `url`), email-template
  images, users' avatars and the email and site logos keep showing the previous image until they are
  edited, so while any does, the old file is kept; the Replace dialog says how many and lists the
  documents, and Used in marks each. A page that still names a replaced file's old address goes on
  counting as a use when it is saved again. Until `nextly media reindex-usage` has run, the old file
  is always kept, and the dialog says so. The kept file goes when the item is deleted, by any
  delete, a folder deleted with its contents included. The focus point is cleared.
  `POST /admin/api/media/:id/replace` answers it, with the upload's own checks, and
  `GET /admin/api/media/:id/usage?byAddress=true` lists the uses by address, with the avatars and
  logos keeping it and whether the usage record is built.

The media usage table, new in this release, records whether each use names the item by its id or
by its address, in an `address` column. `nextly migrate` creates the table with it, and adds it to
a table created from an unreleased build. A usage record built before the column existed, or before
block documents with their own list of items had their addresses recorded too, reads as still
being built, which keeps old files on Replace and the Unused view closed, until
`nextly media reindex-usage` is run once more.
