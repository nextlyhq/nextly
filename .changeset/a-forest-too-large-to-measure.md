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

Past `MAX_WALKABLE_ENTRIES` (1,000,000 — two hundred times the default node cap, so it only fires on forests no product setting would have allowed) each of the three now throws `ForestTooLargeError`, naming the cause: a node placed under more than one parent. Both are exported. Inside `applyOp` the refusal arrives as an `OpError` like every other, so the `...Refusal` helpers still return a reason rather than throwing at their caller.

Nothing a site can store is affected. `JSON.parse` produces fresh objects and cannot express sharing, so a stored document is never such a forest; the bound is reachable only by a forest built in memory by code.
