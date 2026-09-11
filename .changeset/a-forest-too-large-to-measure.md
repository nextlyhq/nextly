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

All three now throw `ForestTooLargeError`, against the ceiling that fits what each one actually spends:

- `countNodes` and `treeDepth` refuse past `MAX_VALUE_PARTS` (4,194,304) — the ceiling the op layer's preflight **already** refused values at, now shared rather than duplicated.
- `documentBytes` refuses past `MAX_SERIALIZED_VALUES`, which is derived from the byte cap it protects: every serialized value contributes at least one byte, so a document that has emitted more values than the cap has bytes cannot come in under it.

Sharing the first number is the point: a second, lower ceiling for the structural readers would let a dry run accept a document the apply then refuses, and would sit below `maxNodes` on a site that legitimately raised it. The serializer keeps its own because it bounds a different resource — a structural walk reads, while serialization BUILDS as it goes, so one numeral buys different amounts of work in each. Both are exported from the package root, and `@nextlyhq/blocks-engine/format` exports the error with `MAX_SERIALIZED_VALUES`, the only one bounding anything that entry exposes.

The messages name the routes to the ceiling without claiming which one a caller hit, because no reader compares object identity and so none can tell. Inside `applyOp` the refusal arrives as an `OpError` like every other, so the `...Refusal` helpers still return a reason rather than throwing at their caller. Composition and the builder's deletion metadata degrade rather than propagate it: an unmeasurable subtree refunds nothing and reports no descendant count, so a page still renders and a block can still be deleted.

Nothing a site can store is affected. `JSON.parse` produces fresh objects and cannot express sharing, so a stored document is never such a forest; the bound is reachable only by a forest built in memory by code.
