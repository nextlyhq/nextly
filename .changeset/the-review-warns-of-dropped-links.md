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

The Schema Builder's review warns before a save drops a relationship's links. When a relationship's links move into or out of a link table, the save carries none of them over, and the review used to call that change safe, or no change at all. It now calls it destructive, counts the links it drops, and says so:

- a many-to-many made a single link drops its link table: "Changing 'tags' from many-to-many to a single link drops its link table and the N links it holds.";
- a single link (or a list of links) made a many-to-many drops the column holding its links, and its new link table starts empty;
- a many-to-many pointed at another collection drops its link table for an empty one.

A field group's many-to-many keeps its ids in its own row, so it has no link table to warn about.
