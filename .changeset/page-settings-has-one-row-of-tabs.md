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

Page settings in the builder has one row of tabs that stays in view: General (the page's title, its address with copy and in-place edit, and its header & footer), Fields (every other field of the page, drawn by the entry form's own renderer, so a field a site adds to the collection appears there with no builder change, under its own rules), then the tabs plugins add, in their order. "Site settings" sits apart at the right of the row for people who may change the site, and opens the site's breakpoints and code in a dialog of their own that says they apply at once. Every tab ends with "Saved with the page when you Save or Publish." and "Open as form", and a save refused for a field shown in Page settings names it with "Show me", which opens the dialog on that field's tab with the field focused.

For plugins (`@experimental`): `useEntryFieldsPanel` takes `group` ("page" or "content") and `leaveOut`, `useEntryFieldsLayout` says which tab of the entry page draws a field, `useRevealField` lets a document view offer "Show me" for a field it draws out of sight, and `usePlaceTabs` hands a place's tabs over as data for a page that draws them in its own row.
