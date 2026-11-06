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

Undo and redo in the Page Builder now take back and repeat a change to the site's shared styles made in Design (a variable, a class, a font or the breakpoints), in order with the page's own edits. The style is saved again as it was, and the page's own save state does not change. A step whose write is refused is dropped from the history with a message. `useEditorState` gains `recordStep` for a change made outside the document, and `undoDepth` is now the document's position in its history: the document edits on the undo stack plus those that fell off its old end. It equals the old count until the history passes its bound, and it no longer counts recorded steps; it is what a save point compares, so a page saved before a run of style changes stays saved. `undo` and `redo` now answer whether the step took effect: a boolean for a document edit, and a promise of one for a recorded step. They were typed as returning nothing, so a caller that ignores the result is unaffected; only code that asserts the old `void` type needs to accept the answer (the builder API is experimental).
