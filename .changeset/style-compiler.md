---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

The engine can now compile a page's stored styles into CSS. `compilePageCss`
turns a document and its site context into one stylesheet plus the class each
node should carry, reading only persisted data: styles are never gathered while
something renders, so a block cannot lose its styling by not being on screen
when the sheet was built.

Design tokens compile to the custom properties they read, logical values stay
logical so one stored style is correct in both reading directions, states
compile to `:hover`, `:focus-visible` and `:active`, and both breakpoint axes
compile to media and container queries. The same document always produces the
same bytes.

States are emitted inside `:where()` so they add no specificity, and every rule
is decided by source order instead: a node's own value beats its block type's
default at every width, and a value set for a state beats a base value set at a
narrower breakpoint.

A value the validator refuses is left out of the stylesheet and reported rather
than written, whether or not the caller validated first. The same holds for
everything the compiler cannot act on: a block type that is not a namespaced
slug, a style state it does not recognise, a breakpoint id that resolves to more
than one definition, two nodes sharing an id, and a malformed envelope are all
left out and named. `StyleCompileContext` takes the document `limits`, so the
node walk stops where validation would have.
