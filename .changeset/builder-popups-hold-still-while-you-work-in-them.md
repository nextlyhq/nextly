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

The builder's popups hold still while you work in them. A type size editor, a color variable, a text style editor, a block's color picker, a spacing side, the add picker and every other popup the builder and the Page Builder's editor open are now placed once when they open, on the side with room, inside the window and clear of the top bar. A row, message or result list appearing or going inside one no longer moves it, so the next click lands on the control you aimed at. Content taller than the room scrolls inside the popup. A popup moves only with its row when the panel under it scrolls, and is placed again when the window is resized. Admin popups outside the builder are unchanged. `BuilderPopoverContent` is exported, experimental, from `@nextlyhq/builder/shell` for a host's own popups beside the editor.
