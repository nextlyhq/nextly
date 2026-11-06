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

The Design panel's Shared styles tab lists the site's block looks, grouped by
block type above the shared styles. Each type's own look comes first, such as
a button's Primary, with a Default chip that says what it covers. The looks its
blocks can wear follow, each with its class and how widely it is used. Every
row draws a small block of its type with the look applied, on the type's base
as the site has edited it.

Choosing a row edits that look in the inspector, with no block selected. A bar
says who the edit reaches ("every Button", since every other look of the type
is laid on its own look, or "every Button that wears it") and offers the way
back to block editing. The Style
controls below write the look through the shared-style save, one undo step per
change, and the blocks the edit reaches are marked on the canvas. Selecting a
block, the bar's Back, or Esc returns to editing blocks.

The look tiles in the Style tab now draw on the type's base with the site's
edits to its own look laid over, as the canvas does.
