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

A block locked in Layers now refuses every change to itself and to everything inside it, at the data layer. `applyOp` refuses updating a locked block or a block inside one (renaming included), removing or moving a block out of a locked one, and putting a block into one; changing only a block's lock is always allowed. A blocks field's save now judges the write against the stored document as well: a write through the API or by an agent that changes, moves or removes a block locked in what is stored is refused with the code `layers-lock-changed`, naming the block, unless the same write unlocks it; a locked block, or a block holding one, can't be deleted in the save that unlocks it. A write that sets a blocks field to `null` while the stored page holds a locked block is refused the same way. A translated field whose language store is not ready yet, and a blocks field inside a group or repeater, are saved unjudged and logged. The lock stays a convenience anyone who may edit the page can lift, not a permission. `@nextlyhq/blocks-engine` also exports `layersLockBreak`, `lockedAncestorOf`, `layersLockChanges` and an `ApplyOptions` type whose `layersLocks: "ignore"` is for system transforms (experimental). In `@nextlyhq/builder`, `lockBlockingMove` and `lockBlockingDelete` now also answer for a block that holds a locked block or sits inside one, as the op layer does.
