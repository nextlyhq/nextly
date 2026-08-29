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

The Insert panel's description strip keeps checking whether it is hiding text,
rather than checking once per block.

The strip becomes a focusable, named region when a description is too long to
fit, so a keyboard can reach the part a pointer would scroll to. It measured
that only when the highlighted block changed — so dragging the panel narrower,
raising the browser zoom, or increasing the font size could push a description
past the edge with nothing noticing. Its tail was then unreachable without a
mouse. Widening the panel had the mirror problem: the description fitted again
and the focus stop stayed, so tabbing toward the blocks went through a region
that had nothing more to show.

It now watches its own size, which catches every one of those, and re-checks on
each render, which catches the case a size watcher cannot see: a block whose
description is replaced with a longer one keeps its identity and its box, and
only the text inside it grows.
