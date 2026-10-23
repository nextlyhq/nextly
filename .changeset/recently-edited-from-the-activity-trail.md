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

Recently edited now lists the entries and Singles most recently saved, newest first, one row per document at its latest save the reader may see, across every collection they may read. It reads the activity trail, the same one Recent activity reads, through a new source, `system:recent-edits`, and each row carries the document's status now and whether it has changes not yet published. A publish or an unpublish on its own is not a save, and a promotion of pending edits keeps the editor's row.

- **The trail says when a write published.** Every path that can publish an entry or a Single marks its row `published: true`, so a promotion of pending edits, which leaves the status published, is no longer read as a save, and Recent activity keeps it out of a run of saves.
- **A Single's save names the fields it changed**, compared by value as an entry's are, on every install.
- **No id where a title belongs.** A save of an untitled entry stores no title, instead of the entry's id.
- **`WidgetSource` gains `filters`** (`@experimental`): the card settings a source narrows by rather than being replaced by. `system:recent-edits` takes `collection` and `onlyMine` as top-level `where` keys, and query validation admits exactly those.
