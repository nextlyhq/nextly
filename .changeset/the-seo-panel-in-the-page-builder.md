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

The SEO panel in the Page Builder. Its Settings dialog has an SEO tab beside General: a page gets its own SEO tab, and a template (or an entry's own design) gets the rules every page it draws follows, written with variables (`{Post title} | {Site name}`), with a preview of one of its pages as it will be served. The Page Builder offers the place other plugins add tabs to (`nextlyhq-plugin-page-builder.settings`); a design's own metadata gains `socialTitle`, and a new `seo` editor operation writes it as one undoable edit. In a page's SEO tab, a value its own design gives reads "from this page's design", and one its collection's template gives "from this page's template"; the design service says which (`designFor`).
