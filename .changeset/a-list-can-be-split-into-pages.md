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

A Collection list can be split into pages, each at its own address: the list on `/news` shows its first page there and page 2 at `/news/page/2`, with links to the previous and next pages and the page numbers under its entries. Turn on **Split into pages** in the list's How many group, or send `paginate: true` with `set-list-query`. `/page/1` redirects permanently to the list's own address, a page past the last or a number spelled any other way is not found, the stored offset applies once before paging, and each page has its own canonical URL and is pre-rendered on a public route within `staticParamsLimit`. One list on a page may be split into pages; a second one, one inside another list, a list of related entries and a list in a component or a Layout region are refused at save, naming the reason. The content routes take experimental `listPages` and `mountPath` options and pass `context.page` and `context.listPagePath` to `render` and `buildMetadata`; `nextly/runtime` and `nextly/route-path` add the experimental `listPageOf`, `listPageNumber`, `slugToPath` and `LIST_PAGE_SEGMENT`.
