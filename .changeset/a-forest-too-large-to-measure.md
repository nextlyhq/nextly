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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The engine's three whole-document measurements — `countNodes`, `treeDepth` and `documentBytes` — now refuse a forest they cannot afford to walk instead of grinding through it or raising a native error.

They walk ENTRIES, not objects, and deliberately so: one node object placed in two slots is two elements of the document, and counting it once would report half a real size and pass a cap the document exceeds. That makes the walk exponential in depth for a forest whose branches share a node object — 21 shared objects reach 2,097,151 entries, and every further object doubles it.

`documentBytes` was the sharp edge. `JSON.stringify` expands each shared node into a copy per path that reaches it, so it allocated 132 MB for 21 objects and raised `RangeError: Invalid string length` at 23 — from a document a few kilobytes in memory, in the one function that decides whether a document may be stored.

All three now throw `ForestTooLargeError`, against **two different bounds** — they count different populations and neither number stands in for the other:

- `countNodes` and `treeDepth` refuse past `MAX_WALKABLE_ENTRIES` (1,000,000), which counts forest ENTRIES.
- `documentBytes` refuses past `MAX_SERIALIZED_VALUES` (2,000,000), which counts the VALUES the serializer visits — measured at six per node, so this is roughly 333,000 nodes.

Both bounds and the error are exported from the package root; `@nextlyhq/blocks-engine/format` exports the error and `MAX_SERIALIZED_VALUES`, which is the only one bounding anything that entry exposes.

The messages name the routes to each bound without claiming which one a caller hit, because neither reader compares object identity and so neither can tell. Inside `applyOp` the refusal arrives as an `OpError` like every other, so the `...Refusal` helpers still return a reason rather than throwing at their caller. Composition and the builder's deletion metadata degrade rather than propagate it: an unmeasurable subtree refunds nothing and reports no descendant count, so a page still renders and a block can still be deleted.

Nothing a site can store is affected. `JSON.parse` produces fresh objects and cannot express sharing, so a stored document is never such a forest; the bound is reachable only by a forest built in memory by code.
