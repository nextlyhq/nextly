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

Bulk edit and the SEO import now reach Singles. Each Single the SEO plugin is added to is a content type of the Bulk edit screen with its one page, read and saved as the person asking at the version they read, and the import reads and writes it beside the collections, its existing field groups included (such as a `metaData` component on a homepage Single), with the same dry run. A Single cannot join the import's one transaction, so its page is written first and put back as it was if anything after it fails.

The SEO tab, Bulk edit and the problem list now show what a page's route sets in its own code. The title, description and social values a content route's `buildMetadata` returns are recorded each time the page's head is worked out, and shown as **Set in code**, so the admin shows what the page is served rather than a pattern's text. A later page of a list is not recorded as the list's own. They are kept in a new internal collection, `nx_seo_route_values`: a site that applies its schema with migrations runs `nextly migrate:create` and `nextly migrate` after upgrading, to create its table.
