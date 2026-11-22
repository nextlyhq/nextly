---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

The block toolbar no longer covers the next block. When the selected block has no room above it on screen, such as the first block on a page with no header, the toolbar is drawn just inside the block's top-left corner instead of below it, and it steps aside while you type in that block until the pointer moves. A block locked in Layers shows an "Unlock" button in its toolbar, which unlocks it as one edit that undo takes back; a block whose lock can't be lifted where it sits shows "Locked" with the reason, and a block inside a locked one shows "Locked by <block name> · Select it". `ToolbarPlacement["side"]` is now `"above" | "inside" | "pinned"`.
