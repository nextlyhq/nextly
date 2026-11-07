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

An entry with its own published design is drawn on the site with that design instead of its collection's template, and takes its SEO settings from it. The content route's `templates` config takes an optional `readFor(collection, id, locale)`, which `pageBuilderContent()` now supplies: it reads the entry's own published design and the collection's published template in one query, as the public reads them. A draft own design never reaches the public page, and a provider without `readFor` keeps drawing every entry with its collection's template. An entry keeps its address while its own design is published, even when its collection's template is unpublished or deleted, and publishing or unpublishing an own design claims or gives up the entry's address in the same transaction. A Schema Builder collection whose template is deleted has no address left, so its entries are not served, own design or not.
