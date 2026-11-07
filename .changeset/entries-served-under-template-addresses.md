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

Collections defined in code can now be served under a template address: `pageBuilder({ templates: { addresses: { posts: "/blog" } } })` serves each published post at `/blog/<its slug>`, drawn with the collection's published template. An address must be written in its one spelling (starting with `/`, no trailing `/`, no empty or dot segment, no scheme or host, not `/`) and lie outside the paths the runtime keeps, two collections may not share one, and the collection must be able to have a template; anything else refuses to start. A published entry holds its address in the page builder's address store in the same transaction as its save, while its collection's template is published: a save at an address another document holds is refused, naming it, and unpublishing, deleting or renaming an entry gives its address up. A template's first publish claims every published entry, leaving an entry whose address a page holds waiting until that page gives it up; unpublishing or deleting the template gives every entry's address up. `@nextlyhq/blocks-react/next` gains `createContentPage` and `createPublicContentPage` (experimental), one route that answers every path from the address store: a page is served as `createBlocksPage` serves it, its draft gate included, an entry is drawn with its collection's template and the entry as its binding source, with metadata from the template's SEO settings, and anything else answers not found. The plugin's `pageBuilderContent()` provides what the route needs.
