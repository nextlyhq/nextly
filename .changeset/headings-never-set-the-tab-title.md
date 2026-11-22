---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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

Headings no longer set a page's browser tab title. A page's title is its SEO title, else its title in the content type's title pattern ("Pricing · Ridgeline"), and never the text of a heading on it, at any level. The core heading block no longer offers its text as the page's title, so the Page Builder offers no title to a route or to the SEO plugin; its prose and images still offer the description and the share image.

With the SEO plugin, the published title order changes: the Page Builder design no longer supplies the title, so the content type's title pattern ranks above anything the design could offer. A page whose heading used to win now shows its SEO title or its title in the pattern. A template's own SEO title is no longer used for the browser title: set the title pattern on the content type instead. In the SEO panel on a Page Builder design, Title on Google is now a read-only line naming the type's title pattern, with a link that opens that type in SEO settings. Descriptions, share images and the shared title from a design are unchanged. The Page Builder's `designSeo` service no longer includes a title in what it answers.
