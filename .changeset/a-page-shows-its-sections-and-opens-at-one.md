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

A page's entry screen now shows the page large enough to read, at the editor's column width and up to 640 px tall (scrolling inside for the rest), with its sections listed beneath by number, block name and first line. Clicking a section, in the preview or in the list, opens the Page Builder with that section selected, shown in Layers and scrolled into view; each is a real link, so it also opens in a new tab. The builder's address gains an optional `section` key; an address naming a section the page no longer has opens with nothing selected. "Preview full page" opens the entry's own preview where the collection has one.

**For plugin authors:** `@nextlyhq/plugin-sdk/admin` adds `useDocumentPreview()` (experimental), which returns the editor's own full-page preview opener, or `null` wherever the editor offers no Preview action. `@nextlyhq/builder` adds `revealNode(root, id)` (experimental) and an optional definition lookup on `blockLabel` and `layerLabel`; existing calls are unchanged. `@nextlyhq/blocks-react` adds `prepareDocumentAsDrawn(document, args)` (experimental), the tree `PageRenderer` walks with placeholders kept, for a surface listing a page's parts beside a picture of it. `@nextlyhq/ui`'s `TreeView` now scrolls a selected row into view when the selection changes from outside the tree, once per change.
