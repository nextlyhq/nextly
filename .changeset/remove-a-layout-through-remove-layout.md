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

Page Builder: a Layout is deleted or unpublished only through **Remove Layout**. The action sits in the bar of the Layout's edit screen, beside History, and is also `POST /layouts/:id/remove` with `{ action: "delete" | "unpublish", dryRun? }`. It refuses the site's default, and it refuses while any page uses the Layout (published pages, unpublished pages and unpublished edits). The dialog lists those pages as links and counts the ones the author can't view, or whose title they may not read. A removal checks up to 2,000 pages and says "at least" past that. A Layout's own delete or unpublish, from the admin or the API, is now refused with "Use Remove Layout… on the Layout's screen to take it down safely.". So is a scheduled release that would unpublish a Layout, when the release runs.

While a removal runs, the Layout can't be edited and no page can be put on it: page writes that add the Layout are refused on the `layout` field (the Layout picker shows the reason), a field check refuses it on writes that skip hooks, and a page save that lands at the very moment its Layout goes is cleared to the site's default. If a page is published on the Layout just as the removal writes, an unpublish is undone and refused, naming that page, and a delete stands but says which pages still use the Layout and that they show the site default. Make default refuses a Layout that is being removed. If a promotion races a delete, the Layout comes back from a copy under a new id and the default points at it. The default repair never writes a copy over a Layout that still exists. Publishing or unpublishing every language at once skips collection hooks, so it bypasses these checks; afterwards the default repair and the removal sweep put the default and make default right.

The plugin adds a table, `page_builder__layout_removals`, and its schema version moves to 2. Development creates the table at boot. A production site applies the shipped migration with its usual `nextly migrate` step before it starts on this version.
