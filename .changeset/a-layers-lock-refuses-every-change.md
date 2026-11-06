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

A block locked in Layers now refuses every change to itself and to everything inside it, at the data layer. `applyOp` refuses updating a locked block or a block inside one (renaming included), removing or moving a block out of a locked one, and putting a block into one; changing only a block's lock is always allowed. A blocks field's save now judges the write against the stored document as well: a write through the API or by an agent that changes, moves or removes a block locked in what is stored is refused with the code `layers-lock-changed`, naming the block, unless the same write unlocks it; a locked block, or a block holding one, can't be deleted in the save that unlocks it. A write that sets a blocks field to `null` while the stored page holds a locked block is refused the same way, judged on the data every `before*` hook leaves, on Singles and imports too. A block locked inside a component holds on every page that places it: a placement's value for an exposed field, or its content for an exposed slot, that changes it is refused with the same code, naming the block, while a value the page already stores is kept. In `nextly`, a plugin field type can set `validateEmpty: true` (experimental) to have its `validate` handed a value a write empties (`null` or `""`), which otherwise never reaches it. A translated field whose language store is not ready yet, and a blocks field inside a group or repeater, are saved unjudged and logged. The lock stays a convenience anyone who may edit the page can lift, not a permission. `@nextlyhq/blocks-engine` also exports `layersLockBreak`, `lockedAncestorOf`, `layersLockChanges` and an `ApplyOptions` type whose `layersLocks: "ignore"` is for system transforms (experimental). In the editor, every path refuses a locked block, a block holding one and a block inside one before it acts, and says why in one wording: Layers, the canvas drag and drop, the block toolbar and menus, the keyboard and the inspector, where a block inside a locked one is read-only and its rename is withheld. Layers rows and the block toolbar show "Locked" on a locked block and "Locked by" its name on every block inside it. A block the saved page still holds locked can't be deleted until its unlock is saved, and Delete says to save first. In `@nextlyhq/builder`, `lockBlockingMove` and `lockBlockingDelete` now also answer for a block that holds a locked block or sits inside one, and an editor's `lockRefusalFor` answers for a Layers lock too: its result is now `LockRefusalFacts`, a union of `SlotLockRefusalFacts` and `LayersLockRefusalFacts`, all exported from `@nextlyhq/builder/shell`. A consumer reading `lock`, `holderType` or `code` narrows first with `isLayersLockFacts(facts)`, also exported there: true for a Layers lock (`label`, `relation`, `verb`), false for a slot lock as before. A block inside a locked one can be locked from the inspector, as from a multiple selection.
