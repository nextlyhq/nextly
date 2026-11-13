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

A production start no longer makes the page builder's address store write anything, and its background work on served addresses no longer grows with the number of pages. Holding an address's lock reads the lock row for update instead of rewriting it, so a start, and every save that takes a lock, writes no lock row, content event, media usage or cache tag for it. Once the start-up passes have settled every page and entry, the plugin keeps a mark of everything the claims follow from (languages, page path, template addresses, the plugin's version, how many pages and entries there are and when they last changed), and a later start whose mark matches skips the passes after a few reads. When they do run, pages are compared with their claims a batch at a time, and only a page whose claims differ is reconciled.
