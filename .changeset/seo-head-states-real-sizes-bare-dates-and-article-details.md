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

The SEO plugin's head states what is true of a page's picture and dates, and an article's details. A picture a route states that is one of the page's own (its cover or featured image) is served at the size the media library stores, not the size the route wrote, so a head never claims 1200 × 630 for a picture of another shape. A day-only date field is stated as the date alone (`2026-11-26`) in structured data and on the card, not as midnight in UTC. A page described as an article, blog post or technical article gets `article:published_time`, `article:modified_time`, `article:author` and one `article:tag` per tag, from the same details its structured data states; a value the route's own Open Graph sets is kept, and never served twice. Core's page-metadata answer gains `social.article` (experimental, `PageArticle`) for these, and a route's own `openGraph.type` and article values now win over an answer's.
