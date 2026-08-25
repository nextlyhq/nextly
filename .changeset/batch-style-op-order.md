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
"create-nextly-app": patch
"nextly": patch
---

Two corrections to the builder's op layer, and an ordering rule for the
experimental multi-selection style API.

The style inspector still refuses a multi-selection — it says how many blocks
are selected and asks for one — so none of this changes what an author can do
today. It is groundwork for the surface that will, and a fix to what a package
consumer calling the exported batch helpers gets now.

A group of ops whose members cancel out no longer records a history entry. Each
op changed something, the document ended where it began, and an entry recording
that would undo to no visible effect — which is the refusal a single op already
gets. Reached by a route a single op cannot take.

`batchStyleWriteOps` and `batchStyleClearOps` return their ops ordered by what
each costs the document, smallest first, rather than in selection order. The
editor folds a group and judges every step against the document's byte cap, so a
selection sitting at that cap — where one block grows to the shared value and
another shrinks by more — would be refused when the growing block came first and
accepted when it came second, for the same resulting document. Taking the
reductions first makes the peak along the way the lowest any order can reach.

Sound for these ops and not in general: a batch targets distinct blocks, so the
resulting document is identical whatever order they run in and only the peak
changes. Cost per block is measured exactly rather than estimated — a style op
replaces the node's whole style envelope, so the difference between what the op
carries and what the node holds is the difference the document sees. Blocks that
cost the same keep selection order.

Callers must pair an op with the node it names rather than with the position it
arrived in; the interface says so.
