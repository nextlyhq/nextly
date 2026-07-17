---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Media folder navigation no longer moves around, and the library remembers how you like it.

**One folder model.** Previously, hiding the folder sidebar relocated folders to a different UI above the grid, and showing it moved them back to the left: two different folder UIs behind one confusing toggle. Now the folder tree in the sidebar is simply shown or hidden by a single toggle button, while inline folder navigation on the page (breadcrumbs plus the current level's folder cards, with the same rename/delete/new-subfolder menus) is always there. Nothing relocates; the tree is an overview, the cards are the drill-down.

**The media library now defaults to the table view** (the grid stays one click away), and your choices stick: view mode, folder-tree visibility, and hidden table columns all persist per browser.

**The media page gains the sort control** the media picker already had (newest/oldest, name, size).

Also: the media dropzone's status colors, the upload preview, the media card, and the focal-point marker now use only design-system tokens (no raw color scales or ad-hoc shadows), and an unused media detail dialog was removed.
