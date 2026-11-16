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

The SEO plugin's Settings and its SEO tab are drawn with the admin's own parts. Settings has six
tabs, each with an address of its own (General, Content types, Share images, Organization, Search
engines and AI, Connections), each a card of rows with **Cancel** and **Save changes** under it; a
production address set by `NEXTLY_PRODUCTION_ADDRESSES` is shown read-only, and llms.txt and the
plain-text copies moved to Search engines and AI. The SEO tab shows the page on Google beside its
shared card, says each problem above the fields with its one fix (such as **Make a share image**),
and says under an empty title or description what it uses instead. The side panel's SEO line reads
"2 to check".
