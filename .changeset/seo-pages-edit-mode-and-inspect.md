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

The SEO section's Pages lists every public page with the title and description search is given
for it, where the title comes from, and its status, read from the problem list. Search it, narrow
it by type and status, and from each row edit its SEO, inspect what search engines receive, add a
redirect or open the page. Its Edit mode replaces Bulk edit: titles and descriptions are typed
straight into the list and saved one content type at a time, and a save that stops part-way names
the pages not saved and keeps their changes. An old Bulk edit link opens Edit mode.

Inspect fetches a page as Google, Bing, Facebook, X, LinkedIn and an AI crawler, says for each
whether it matches, shows each value Nextly holds with where it comes from beside what the chosen
crawler received, lists the page's structured data and its JSON-LD, and says when a network won't
show the share image (an SVG on any card). A difference that needs no fix is said to be expected,
and an address that isn't fetched, or a fetch that stops at its limits, says why while still
showing what Nextly holds.

For code reading the check's answer: its crawlers are now `googlebot`, `bingbot`, `facebook`,
`x`, `linkedin` and `ai` (Slack is gone), the `/received/pages` route is removed, and
`SeoReceivedPage` is no longer exported from `@nextlyhq/plugin-seo/admin`; use `SeoInspectPage`.
