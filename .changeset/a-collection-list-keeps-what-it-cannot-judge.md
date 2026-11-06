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

A collection list is judged the same way in the editor and at save in more cases, and a Layout's header no longer has its badge drawn over its links.

- The editor gives a list's fields the kind a save gives them, so it refuses a sort on a time of day and takes a filter on a field type a plugin adds, as the save does.
- A component's list of "this entry's" related entries is judged by its shape when the component is saved, since the entries are those of the pages placing it. Before, the save judged it against the component store and refused a list that works on those pages.
- A save no longer refuses a list problem when the stored page can't be read, or when the stored page's components can only be composed in part: the problem may be one the page already had. The server log says when a placed component's list problem was kept this way.
- Checking a page's lists reads the fields of no more lists than the check visits.
- On the canvas, a Layout region's lock sits outside the region, below a header and above a footer, so it never covers the region's content. Hover or focus shows "Header · from Layout"; a click, Enter or Space opens the tag with Edit Layout beside it. The lock is the region's one focus stop. Escape, a click elsewhere or a new selection closes the tag. Where outside has no room on screen, the lock is drawn inside, and at 100% it stays in the part of the canvas on screen.
