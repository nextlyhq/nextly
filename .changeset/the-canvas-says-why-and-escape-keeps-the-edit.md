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

The page builder says why every dimmed block action is dimmed, in the block toolbar and the context menu, the edges of a container included ("Already at the top here", "Already at the top level of the page"). Escape while typing on the canvas keeps what was typed and ends the edit; a second Escape selects the block's parent. Where the write can't be made, the text stays open with the words in it and the editor says why: the page refused it (a size cap), the block was locked while it was typed, or someone else changed the same text meanwhile, which is never written over. A second Escape over the same words lets them go; words revised since are tried again, and a held Escape key does not count as a second press. `InlineEditRefusal` gains `"no-longer-editable"`, for a value locked or no longer storable while its element is still on the page; it used to come back as `discarded`, which is now kept for an element that has left the page. A host branching on the reason should handle the new value. `useInlineText` takes an optional `onFinished`, told when a key's way out of a line was refused.
