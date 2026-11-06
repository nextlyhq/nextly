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

A blocks page's lists now read through the route's public reader, with no wiring: a route
given no `data` lists published entries and public fields only, as an anonymous visitor reads
them, in the route's language. Each read is cached and tagged with its collection.

`data` on `createBlocksPage`, `createPublicBlocksPage`, `createSinglePage` and
`createPublicSinglePage` now takes a function from that reader to a provider, such as
`reader => createDefaultDataProvider(reader, { collections: ["posts"] })`. **Breaking:** a
provider object is refused when the route is built; wrap it, or drop it to use the default.
`@nextlyhq/blocks-react` exports `createDefaultDataProvider` and the reader's types
(`@experimental`), and `BlocksQuery` carries filter rows, several sort keys, `page` and
`select`.

`core/collection-loop` always sends a sort, so a loop without one lists in id order, and a
stored sort the reader refuses lists in id order instead of rendering empty (any other
failure is not retried). **Breaking for a provider written by hand:** `sort` arrives as a
string or an array of keys, and as `[]` from a loop with no sort; read `[sort ?? []].flat()`.

`createPublicReader` needs only `find`; `count` is a one-row read of ids.
