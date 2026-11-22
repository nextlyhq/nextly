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

The Page Builder's SEO tab now shows exactly where the page's edit page shows its SEO tab, by
the same rule, read from the admin rather than from lists the SEO plugin copied at startup. Page
settings shows one SEO panel: where the SEO plugin edits SEO for the page's type, General has no
second preview and no message that the plugin is missing, and the right panel's page settings
show the page's result on Google from the SEO tab's own answer. Where the plugin is installed but
SEO is off for the type, both say "SEO is turned off for" the type's pages, with a link to the SEO
settings for people who may change them. Without the SEO plugin, General keeps its read-only
"Search and sharing" preview, built from the page's title, first heading and first image.

New, `@experimental`: `useContributionApplies(place, id, document)` in
`@nextlyhq/plugin-sdk/admin`, which answers whether the admin would draw a contribution at a
place for a document; `setLeftOut` on `PlaceTabProps`, for a tab that applies to some documents
only; and `fallback` and `blockProps` on `TargetSlot`. The Page Builder's Settings place also
takes blocks, drawn where the builder shows the page's search result.
