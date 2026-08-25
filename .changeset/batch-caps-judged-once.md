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

The editor applies a group of ops by folding it, and every step is judged
against the document's byte cap. A selection sitting at that cap, where one
block grows to the shared value and another shrinks by more than it added, was
therefore refused when the growing block came first and accepted when it came
second — for an edit whose result is smaller than what the document started
from either way.

The batch now writes the shrinking blocks first, so the peak along the way is
the lowest any order can reach. Sound to reorder here, where it would not be in
general: a batch's ops target distinct blocks — one per selection — so the
resulting document is identical whatever order they run in, and only the peak
changes. Which block costs what is measured exactly rather than estimated: a
style op replaces the node's whole style envelope, so the difference between
what the op carries and what the node holds is the difference the document sees.

The caps stay where they were. Letting a group exceed the cap transiently was
tried and withdrawn — a document that transiently breaks its own invariant is
one whose undo may not be applicable, and undo pops its entry before replaying
it, so an inverse refused on the way out loses the edit it was meant to take
back.

Separately: a group whose ops cancel out now records nothing. Each op changed
something, the document ended where it began, and an entry recording that would
undo to no visible effect — which is the refusal a single op already gets.
