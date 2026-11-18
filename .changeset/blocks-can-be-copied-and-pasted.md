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

Blocks can be copied, cut and pasted in the page builder. Select blocks and press Ctrl+C (⌘C on a Mac) or Ctrl+X, then Ctrl+V; Copy, Cut and Paste are also in the block toolbar's More actions menu, the right-click menu and search. A paste lands where a clicked block would, is one undo step and is selected, and works on another page or in another browser tab of the same site, keeping the site's shared styles, block styles, variables, components and media. Cut is refused for a locked block, as Delete is, and a paste the page can't take is refused with the reason. Blocks copied on another site are refused with a pointer to Export and Import. Typing in a field or in a block's text keeps the keys for the text. `@nextlyhq/blocks-engine` adds `planPasteBlocks`, the pure planner the editor pastes through.
