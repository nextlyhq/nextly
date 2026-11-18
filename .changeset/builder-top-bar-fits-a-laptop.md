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
"nextly": patch
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
---

The page builder's top bar fits a 1280px laptop with the rail and both panels
open. Save, Publish, the active width and the buttons beside them keep their
whole size and no longer slide over the zoom; the page title is what shortens,
with the whole title in its tooltip, and only once it is at its shortest do
Preview's word and the page data meter's "what's this?" step aside, keeping
their names. Where the system asks for reduced motion, the bar's buttons no
longer ease between states. Shift+F6 now moves back through the editor's areas,
as F6 moves forward, and under forced colours the line showing where a block
goes is drawn in the system's highlight colour instead of vanishing.

`@nextlyhq/ui`'s `DropdownMenu` is no longer modal by default. An open menu
left the page around it focusable but hidden from screen readers. Now a press
outside a menu closes it and also reaches what was pressed, and the page can
scroll while a menu is open. A menu that must hold the page passes `modal`.
