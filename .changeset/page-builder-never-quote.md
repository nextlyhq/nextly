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

A Section or a Box can be marked **Never quote this** in the Page Builder's Content tab, after Show when. Its element is rendered with `data-nosnippet`, so search engines that read it, Google among them, show none of its text under the page's link and Google won't use it as a direct source in AI Overviews or AI Mode; visitors still see it. It is the Page Builder's own setting and works with or without the SEO plugin. Google reads the mark on `section` and `div` elements only, so a block whose HTML tag is another one says so. The canvas tags a marked block "not quoted in search" on hover, and its Layers row says so to screen readers.

The block document format gains an optional node field, `nosnippet`, written only as `true`. Documents written before it read and render exactly as they did. `containerRootTag` (experimental) in `@nextlyhq/blocks-react` says which element a Section or Box renders as its root.
