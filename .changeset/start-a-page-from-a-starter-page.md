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

A page can start from a starter page: a ready-made page body, picked in the New page dialog's "Start from" or on an empty page's "or start from a page" row in the builder. Its blocks are copied once, each with a new id, so a later change to the starter never reaches the page and a change on the page never reaches the starter. It fills the page body only, with the header and footer chosen in the dialog, and in the builder it is one step, so one Undo empties the page again. Each starter's preview is drawn from its own blocks in the site's own colours and fonts. A starter carries no pictures: its Images show their empty state, so nothing is broken and nothing is loaded from another site.

Developers register starter pages in code with `pageBuilder({ starterPages })`, and plugins declare them under `contributes.declarations["@nextlyhq/plugin-page-builder"].starterPages`; `builtInStarterPages: false` lists only the ones registered in code. Every starter is checked at start-up, and a malformed one, a repeated id, a block the site doesn't have, a placed component, a picture or an address to load, or blocks that fail validation stop the start with a message naming the starter and where it came from. A starter needing a block or a variable the site no longer has is left out of the list. All of it is `@experimental`.

`@nextlyhq/plugin-sdk/blocks` gains `defineStarterPage`, `StarterPageDefinition` and the `BlockNode` type, `@experimental`. `@nextlyhq/builder/shell` gains `applyStarterPage` and `planStarterPage`, `@experimental`. The page builder gains a `GET /starter-pages` route listing the starters the site offers now. The New page read's `NewPageStarter`, `@experimental`, now carries `description` and the starter's blocks as `document` in place of `picture`, which nothing filled: its preview is drawn from the blocks.
