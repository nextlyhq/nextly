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

Adding a variable in the Design panel now happens where the author is. The
"+" in each group's heading is gone. Every list ends with its own add row
instead:

- "+ Add colour";
- "+ Add type size";
- "+ Add spacing", "+ Add radius" and "+ Add shadow";
- "+ Add font" and "+ Add font weight";
- "+ Add value", whose menu offers a size, a number, a duration or a custom
  value.

An empty group keeps its one line, with its add row under it, and a folded
group folds its add row away with its rows.

Adding keeps the search. The new variable is added as the last row of its
group, brought into view, and opened beside its row with its name focused.
While a search is on that the new row doesn't match, the row still shows,
marked "New", until its editor closes; focus then goes back to the add row.

`TokensPanel` no longer takes `onSearch`: adding was the only thing that
changed the host's search.
