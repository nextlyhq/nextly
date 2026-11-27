---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Deleted entries now wait in a trash for 30 days instead of being removed at once (experimental).

- **Deleting moves to the trash.** Deleting an entry of any collection, a plugin's included, through any door (REST, the Direct API, a plugin's collection service, a batch) copies everything it stores into one trash record: its own row, its row in each language, its field-group rows, its many-to-many links and the records about it, with who deleted it and when. It is then gone from every list, read, count, search, relation and the public site, exactly as a deleted entry is. Its version history is kept. The site's deleted events still fire at the delete.
- **Restoring.** `nextly.trash.restore({ id })`, `POST /api/trash/restore` and `nextly trash restore <id>` put the entry back under its id, in every language, with its history, as a draft where it had been published. Where another entry has taken a unique value it held (its slug), nothing is written and the value is named; restore again with a new one (`values: { slug }`, or `--set slug=…`). The site's created event fires, marked `restoredFrom: "trash"` (a new, optional webhook field; a plain create does not carry it), and the in-process `collection.<slug>.created` event is announced as for a create.
- **Emptying.** `nextly.trash.empty()`, `POST /api/trash/empty` and `nextly trash empty` remove entries for good, and a job removes each one 30 days after it was trashed. `nextly.trash.list()`, `GET /api/trash` and `nextly trash list` show what is there. `nextly trash restore --dry-run` and `nextly trash empty --dry-run` name what they would do and change nothing.
- **Permissions.** Every collection gains `restore-<collection>` and `empty-<collection>` ("Empty trash for …", removing deleted entries for good), granted to the preset roles as deleting is: Admin and Editor hold them, Author and Viewer do not. A person sees only the trashed entries they may read.
- **Not yet.** A relation set to delete its referring entries with it (`cascade`) still deletes them for good, as before, rather than trashing them too; an entry of a collection renamed since, together with its table, cannot be restored yet; and an entry that was published and held unpublished edits is refused for now (it stays in the trash), until a restore folds those edits in as unpublishing does. All three are being addressed before the next release.
- **Upgrading.** `nextly migrate` creates the `nextly_trash` table. Until it runs, deletes stay permanent, with one warning naming the command. A deleted entry's slug is free for a new entry at once, as before; restoring the old entry afterwards asks for a new slug.
