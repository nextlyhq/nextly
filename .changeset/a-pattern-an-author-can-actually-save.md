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

An author could browse the pattern library and never put anything in it. The
planner that turns a selection into a stored pattern had no caller, so the
Patterns tier shipped with nothing to show and no way to add to it.

The page builder now contributes the write that fills it. The editor posts the
document and the selection, and the SERVER plans the save — because the planner
decides what a pattern is by asking the block registry, and the two registries
are not the same: the browser holds the core blocks, while the server also holds
every block another plugin declared. A browser that planned its own save would
answer nesting questions about blocks it has never heard of, and store a pattern
nothing can place.

The row is created published, because a draft pattern is deliberately kept out
of the insert panel — leaving the column's default would answer the author with
a pattern their own library does not show. The write runs as the user, so an
author without permission to publish one is refused by the collection rather
than by the route having been careful. A selection the planner will not save is
refused before anything is written, with the planner's own cause travelling
verbatim so the caller compares against the vocabulary it already has.
