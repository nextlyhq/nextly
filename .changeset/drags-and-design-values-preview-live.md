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

The Page Builder's canvas follows a drag while the pointer moves. Dragging a number field's label, dragging in the colour picker or moving a slider (such as opacity) shows each value on the page as it changes, not only when the pointer is lifted; the whole drag is still one step of Undo, and Escape during a label drag puts the value back.

A Design value (a site variable) is drawn on the canvas as it is typed or picked, and the site is written only once, when the edit ends: on leaving the field, pressing Enter or closing the picker. Half a colour keeps the last valid one on the canvas. Every kind of value previews this way.

For a host of the builder's Design panel: `TokensPanel` takes an optional `onPreview(tokens | null)`, called with the whole set while a value is typed or picked and with `null` when the edit ends, before its one `onChange`. Without it, nothing changes.
