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

SEO for pages built in code. A route that renders a page from its own code, such as `/pricing`, adds one line, `export const generateMetadata = () => seoMetadata("/pricing", { metadata })`, and the SEO set for that address reaches its head through the same order of who wins as every other page: what a person set first, then the route's own title, description and social values, then the site's title pattern and defaults. The new Pages and addresses screen, under SEO in the admin, lists every public address the site knows of (each entry's, each route with no variable part, and each address a route declares through `generateStaticParams`, read from the production build), marks each route that does not call `seoMetadata` yet, and sets a page's title, description, visibility and share image by address. A connected page that search engines may index is listed in the sitemap. A site whose `next.config` sets `distDir` passes the same directory as `nextBuildDir`.
