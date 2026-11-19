---
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

An empty page in the page builder greets you with a calm start area in the page's body, between the Layout's header and footer, in place of the "Start your page" card that could sit over the footer:

- A page's start area is headed "Start building <page title>", and a component, saved section or collection template's "Add the first block". It holds a primary "＋ Add a block", which opens the in-place block picker at the page's top level, and a secondary "Insert a saved section", which opens the Add panel on its Saved sections tab with its search ready. Under them is the line "or drag a block here".
- It is drawn in the builder's own panel, text and accent colours, at the screen's size whatever the zoom. The empty body is held open for it in the editor alone, so the footer sits below it. The published page draws nothing there.
- While a block is dragged from the Add panel, the start area shows as where it drops, and the block lands at the page's top level.
- A host can pass starter pages, which show as a row of tiles under "or start from a page". With none, the row is absent.
- The editor opens the Add panel on an empty page, whichever left panel was last open, unless the author hid the left side themselves.

`PageInserters` takes the start area's words and actions as `start` (`title`, `onStart`, `onSavedSection`, `starters`, `onStarter`) and a `dragging` flag. `BuilderShell`'s `openPanelRequest` takes `unlessHidden`, and `InsertPanel` takes `summonedTab`.
