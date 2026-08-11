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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

A content route no longer offers static generation it cannot perform.

`createContentRoute` and `createBlocksPage` read access-enforced content, so no
path they serve can be pre-rendered — and they now return no
`generateStaticParams` at all. Next classifies a route as static BECAUSE that
export exists, and every dynamic marking inside a static render is an error, so
an enforced route that also exported one answered 500 on every path whenever its
collection was empty at build time. Its runtime behaviour depended on whether
the database had rows in it when the build ran.

For public content that should be cached and pre-rendered, call the new
`createPublicContentRoute` / `createPublicBlocksPage`. They read trusted and do
return `generateStaticParams`.

Replaces the `overrideAccess` option on `ContentRouteConfig`, which had no
consumers: the posture is now stated by which factory you call.
