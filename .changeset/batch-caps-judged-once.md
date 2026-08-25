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

A style edit across a multi-selection is no longer refused because of the order
the blocks happened to be selected in.

The editor applies a group of ops as one atomic edit, and the document's caps
were being measured after every op in that group. A selection sitting at the
byte cap, where one block grows to the shared value and another shrinks by more
than it added, was therefore refused when the growing block came first and
accepted when it came second — for an edit whose result is smaller than what
the document started from either way.

Intermediate states inside an atomic group are not documents. Nothing renders
them, saves them or puts them in history, so refusing one refuses a document
that never exists. The caps are now judged once, with the group's starting
document on one side and its final document on the other — the same question a
single op is judged by, asked of the group.

Deferring is not skipping: a group that leaves the document over the cap is
refused exactly as one op would be, and a group that shrinks an already-oversized
document is allowed exactly as a shrinking edit already was.

Only the size cap defers, and only up to a ceiling. The node and depth caps stay
per op, because they also bound the WORK an edit may cost before it is refused —
a group free of them could validate and insert a subtree of any size before
anything objected. The size cap defers to what the document started with plus one
more document's worth, because an op's inverse snapshots the value it replaced,
so a group free to write an arbitrarily large intermediate would leave that value
alive in undo history behind a document that fits.

A group whose ops cancel out records nothing. Each op changed something, the
document ended where it began, and an entry recording that would undo to no
visible effect.
