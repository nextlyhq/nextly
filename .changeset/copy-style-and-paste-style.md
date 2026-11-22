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

In the page builder, "Copy style" and "Paste style" give many blocks one block's look in one step. They sit beside Copy and Paste in a block's More actions menu, its right-click menu and search. Each selected block gets the copied block's own settings on every device and state, its block style, its text style and its shared styles, in place of its own, while its text, images and links stay as they were, and one undo takes it back. A paste writes to the blocks themselves, never into a shared style, and a setting a block can't have is left out with a plain count ("3 settings don't apply to Image").

`@nextlyhq/blocks-engine` exports `supportedStylesOf` (experimental): the style values a block type's supports keep, and how many they don't. "Turn into" and the builder's Paste style both read it.
