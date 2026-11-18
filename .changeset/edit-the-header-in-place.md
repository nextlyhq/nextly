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

The builder edits the site header or footer right on the page. "Edit header" in the sidebar, a double-click on the header, or Enter while it is selected, dims the rest of the page and shows a bar above the canvas: "Editing the site header · changes show on N pages", with "Unpublished changes from <when>" for a version not yet published. Layers, the inspector and the Add panel then work on the header's blocks, Undo and Redo step through its changes only, and a click on the dimmed page highlights Done. The top bar's "Save header" and "Publish header" act on the header ("Publish the header to N pages?"), and the page's own unsaved changes are kept for its Save after Done. Done asks "Publish your header changes?" with "Publish to N pages", "Save as draft", "Discard" and "Keep editing" (no publish without the right to). Someone else having the header open is said by name, a failed save says so with "Try again", leaving or reloading with unsaved header changes asks first, and they are kept as the header's own recovery point.
