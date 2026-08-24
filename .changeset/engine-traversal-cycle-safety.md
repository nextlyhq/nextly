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
"@nextlyhq/eslint-plugin": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

The engine's tree primitives terminate on a document whose slots form a cycle.

Such a document reaches these functions the same way every other malformed
shape does: a stored forest is not required to have been validated, and an
in-process producer can build one directly. `countNodes`, `findNode` asked for
an absent id, `updateNode`, `duplicateNode` and `reidSubtree` exited with
`RangeError: Maximum call stack size exceeded`, and `treeDepth` did not throw
at all — it SPUN, holding a caller open rather than failing, which is the
version nobody attributes correctly.

Each now carries the ancestors its current position was reached through, so a
node reached through itself is not descended into again. That is deliberately
narrower than skipping every node already seen: one node object placed in two
different slots is two elements of the document and is still counted, measured
and rebuilt twice, exactly as before. Behaviour on every acyclic document is
unchanged.

An immutable rebuild cannot reproduce a cycle, since the result would have to
contain itself. `updateNode` and `reidSubtree` therefore drop the edge that
closes it and return a finite forest rather than failing the operation.

`duplicateNode` REFUSES instead, returning the forest unchanged, and the
difference is deliberate. It adds a node rather than transforming one, so the
original stays in the result — a copy taken from a forest that cannot be
serialized still cannot be serialized, whatever is done to the clone. Reporting
success there would hand back a document that cannot be stored.
