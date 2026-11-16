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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"nextly": patch
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
---

A block a component locks in Layers is held in the editor on every page that places it: the field that drives it is read-only in the placement's panel with "Set by the component <name>. Change it where the component is edited.", double-clicking its text on the canvas says the same instead of opening it, and an edit that would change it is refused before it is applied, judged as the save judges it. A field a `contentOnly` area holds says that area's reason the same way. A component's variant that sets a value on a block the component locks is refused when the component is saved, naming the block and the variant. Moving another block across a locked one is now allowed by the save as it is by the editor: a reorder is read as the fewest blocks moved that explain it, so the locked block counts as moved only when moving it is the shorter explanation, and the editor refuses a group of moves the save would read that way. In `@nextlyhq/blocks-engine`, `componentLayersLocks`, `placedLockChanges`, `placementsAsComponentsHoldThem` and `variantLockChanges` are new exports; in `@nextlyhq/builder`, `LockedRelation` gains `"component"` (a consumer switching over it adds a case, worded with `lockRefusalWording`), `useEditorState` takes an optional `componentName`, and `lockViewOf` is exported from `@nextlyhq/builder/shell`.
