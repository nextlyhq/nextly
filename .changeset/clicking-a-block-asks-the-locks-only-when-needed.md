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

Clicking a block, opening the Add panel, adding a block, undoing and leaving a text field no longer stall the page builder on a long page. Whether a lock allows each block action used to be worked out on every click by trying every action on a copy of the whole page, and the Add panel tried every block it offers the same way. Now a lock is asked only when an author can act on its answer: when the toolbar's More menu, the right-click menu, a block card's menu, the Layers row menu or the command palette opens, or when an action runs. Each answer is kept for that version of the page, so a menu and a keystroke share it. The Add panel reads its tiles' locks from the place a block would go, and tries an insert only for the block actually added. On a click, the toolbar no longer dims a button for a slot's lock or for a reason only a full save plan finds (a gap in the selection, a block that cannot stand alone in a pattern): pressing it says why, as the menus do. For code using `@nextlyhq/builder/shell`: `useBlockKeyboardActions` still returns `selectionActions` and `depthMoves`, now decided without asking the locks, and adds `offer`, whose `withLocks()` answers the same verbs with the locks asked, for a menu as it opens. The verbs `BlockKeyboardActions` shares through `onShareVerbs` add `withLocks()` and `subscribe()` the same way; a menu drawn from them should read `withLocks()` while it is open.
