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

The edit pages draw what plugins add to them (experimental).

- A collection entry's and a Single's edit pages draw the blocks sent to them around their own two, `document-bar` (the bar with the banners under it) and `editor` (the form's notices, the fields and the side panel), in the order sent, each behind its own error boundary. A block replacing either is drawn where it was.
- A contributed tab heads the field column after the page's own content, labelled "Content"; the document bar and the side panel stay whichever tab is open.
- A Single's side panel now draws the sections plugins declare at its place, as a collection entry's does, ordered among its own four by the same rule, with `narrow: "above-form"` honoured on both.
- A side panel section's component receives `SidebarSectionProps` (new, from `@nextlyhq/plugin-sdk/admin`): the place's `context` and `entry`, and on a collection entry's page also every field of `DocumentPanelSectionProps`, so a section written for the document panel keeps working. Sections wait until the signed-in admin is known, and a form of a section's own no longer submits the document.
- An edit page with nothing contributed is unchanged.
- `PlaceTabs` takes an optional `className` for its strip and the contributed tabs' panels, leaving the page's own content as it is.
