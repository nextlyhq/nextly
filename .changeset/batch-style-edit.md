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

Multi-selection style editing gains its model layer, and every style write in
the builder now goes through it.

Selecting several blocks and changing one property is a different question from
editing one block, because it has to say what a shared value MEANS before it can
offer to change it. Three blocks agreeing on a padding is not the same as three
blocks disagreeing, and a control showing nothing is not the same as one showing
"Mixed": typing into the first sets a value nobody had, while typing into the
second replaces values that differ. An author is entitled to know which of those
they are about to do, so a shared value is a third answer rather than an absence.

Values are compared by their serialised shape with keys sorted at every level. A
style value is a tree, and two blocks holding equal trees hold equal values
however separately those trees were assembled — comparing by reference reports
every selection as mixed, which is always.

A batch produces ONE group of ops for one history entry, built per node from
that node's own stored styles rather than from the primary's. A style op patches
the whole envelope, so an op built once and repeated carries the primary's
unrelated declarations to every other block.

The single-block path now goes through the same layer as a group of one. The
alternative was two implementations of "what ops set this address", which agree
the day they are written and drift afterwards — leaving the surface an author
reaches through a multi-selection behaving unlike the one they reach through a
single click, with each path's own tests passing.
