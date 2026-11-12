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

Content routes take the site's own `notFound`. `createContentRoute`, `createPublicContentRoute`, `createSingleRoute` and `createPublicSingleRoute` from `nextly/runtime`, and `createContentPage`, `createPublicContentPage`, `createBlocksPage`, `createPublicBlocksPage`, `createSinglePage` and `createPublicSinglePage` from `@nextlyhq/blocks-react/next`, accept a `notFound` function that answers a path the route has nothing for in place of Next.js's `notFound()`, from the page and from `generateMetadata` alike, so a site can do something for each miss, such as logging the address. A handler that returns is followed by `notFound()`, and a route given none answers as before. The option is experimental.
