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

The SEO plugin lists every page built in code with a variable part in its route, such as `/docs/[[...slug]]` or `/compare/[slug]`, in the sitemap, `llms.txt`, plain-text copies and SEO › Pages, even where the host doesn't ship Next.js's prerender manifest with the server. While `next build` renders the site it records each page whose route calls `seoMetadata`, and each address `seoStaticParams` declares, in the site's database under the build's id; the running site lists what the build it serves recorded. The manifest, where it is there, still leaves out an address that answered not found.

A new experimental `codeAddresses` option states the pages of a route rendered on demand, by its params, and the Markdown a page built in code's plain-text copy is made of, to which the plugin adds front matter. Pages shows where each page came from and a status line naming the build and when it recorded; the Overview's checklist says whether pages built in code are listed.

Run `nextly migrate` after upgrading: the plugin adds one table, `seo__code_addresses` (plugin schema 4). Nothing existing is rewritten. The Pages build route (`/pages/build`) now also answers `recorded` and `dynamicRoutes`.
