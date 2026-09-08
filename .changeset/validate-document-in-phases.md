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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

Document validation is split into the phases it always had, with no change to
what it reports.

`validateDocument` was one 257-line function holding four separate jobs: judging
the document's own envelope, deciding what the size survey permits, assembling
the state every node check shares, and walking the forest. The envelope's two
early returns sat in the middle of it, which is why the walk was hard to find at
all — and why nothing in the file could be repaired, since the complexity gate
refuses any edit to a function that far over threshold, however small.

Each phase is now its own function, named for the question it answers:
`documentEnvelope` (is this a document, and is its outer shape sound),
`nodeCheckState` (configuration, not traversal), `validateNodeForest` (the
bounded breadth-first walk) and `enqueueChildren` (where a slot child sits).

The order of the checks is the order of the issues, and it is load-bearing —
callers assert on the first one — so the phases run in exactly the order they
did. Every fixture in the validation corpus produces a byte-identical result,
survey included.
