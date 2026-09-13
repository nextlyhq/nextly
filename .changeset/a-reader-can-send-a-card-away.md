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

A reader can send a first-run card away from the card itself, and hiding or removing any card now says so out loud.

A widget declaring `dismissible` draws a control on the card, outside edit mode: the cards that address somebody who has just arrived should not require discovering the dashboard editor first. Dismissing hides the placement rather than deleting it, so the arrangement keeps it and the reader restores it from the same controls as any other card -- no schema change in any dialect.

The control commits on its own rather than through the editor's draft, because the draft exists only while editing and a standing control wired to it would do nothing at all. It carries the read's own `version` and `scope`, so a dismiss raced against another tab is refused rather than silently overwriting it, and it renumbers nothing -- hiding moves no card.

`toggleHidden` and `remove` now announce through the grid's existing live region. Both changed the dashboard in silence before: a card stopped being rendered, and a reader who could not see that had nothing to distinguish it from the page having failed.
