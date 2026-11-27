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

The SEO plugin serves a page's own picture at the right size by itself. Where a page's automatic share image, its cover or featured image, is not the shape or size networks show in full, the head names a 1200 × 630 JPEG cut from it around its focal point, with the picture's alt text, at a public route of the plugin's (`/share-card/<media id>/<version>.jpg`). The address carries the picture's version (its stored file and focal point), so a new picture makes a new card and a card never shows an earlier one; it is cut when first fetched and cached for a year, with nothing stored. A share image chosen for the page, or made by hand, is never replaced. The SEO tab shows the card and what it was cut from, and the sitemap lists the picture itself.
