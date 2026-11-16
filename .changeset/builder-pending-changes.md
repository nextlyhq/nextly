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

The Schema Builder keeps every edit as a pending change until it is saved: the toolbar shows how many are unsaved, with Undo and Redo (also Ctrl or Cmd with Z, and Shift or Y to redo, outside text inputs), each saying what it did, and Discard all, which asks first and names how many changes go. Each changed row in the outline is marked new, changed, moved or deleted, an undone edit or one put back as it was saved counts as none, and a deleted field stays in the outline, marked with how many fields inside go with it, until it is saved or undone.

Leaving the Schema Builder with unsaved changes asks first, the same way an entry's form does: an in-app link, a field group's editor or used-by link, and the browser's back each ask in one dialog, and a reload or closing the tab asks through the browser. Nothing is asked when there are no unsaved changes or the builder is read-only.
