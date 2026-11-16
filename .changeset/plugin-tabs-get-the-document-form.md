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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A plugin's tab on an edit page can now work with the document (experimental).

- A tab at `collection.edit` or `single.edit` receives `DocumentTabProps`: the place's `context` and `entry`, the document form's `control`, and the `documentLock` a side panel section is told. This holds on a saved entry, a new one and a Single. A tab reads what the author has typed and not yet saved, and what it writes through `control` is stored by the bar's Save and Publish with everything else.
- Every contributed tab receives `setBadge`, which shows a count beside the tab's label (`PlaceTabBadge`: a count, what it means in words, and an optional `"attention"` tone), or none with `null`. The count is read out with the label, and a count past 99 is drawn as "99+".
- A contributed tab stays mounted while another tab is open, so what it holds is kept and its count stays current.
- The edit pages keep the open tab in the address as `?tab=<id>`, so a reload or a shared link opens it again. Switching tabs replaces the history entry, and the unsaved-changes warning no longer asks when only the tab changes.
- `PlaceTabProps`, `PlaceTabBadge` and `DocumentTabProps` are exported from `@nextlyhq/plugin-sdk/admin`.
