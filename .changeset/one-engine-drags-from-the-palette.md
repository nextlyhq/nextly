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
---

A block can now be dragged from the insert panel onto the canvas.

Dragging a block from the insert panel onto the canvas shares everything with
dragging a block already on it — where a drop may land, when the target is
allowed to change, the autoscroll, the indicator and Escape. The two differ at
exactly one call, made when the pointer is released: a move rewrites a node's
position, an insert builds the node the palette described and adds it there.

The node is built at the release rather than at the start of the gesture, so
the document is untouched while the author is still choosing, and the whole
drag leaves a single entry on the undo stack.

Clicking a row still inserts, exactly as before. The drag only ever adds a
second way to do it.
