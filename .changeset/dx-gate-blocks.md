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

Blocks now receive a render context, so a block that reads content is an
ordinary async component rather than something the API had no way to express.
A slot is now something a block draws rather than something it receives already
drawn: `renderSlot(name, ctx?)` replaces the map of rendered children, so a
repeater can draw its template once per entry with that entry's values, and a
block that hides a panel no longer pays to render it.

A block's `supports` is checked against the catalog while it is being written
instead of at boot, and a plugin that registers its own support adds it to that
check by augmenting `BlockSupportKeys` in `@nextlyhq/plugin-sdk/blocks`. The
types a block definition asks for are all reachable from that same subpath, so
writing a block no longer means importing the engine directly. Renderers now
describe what they provide once by augmenting `BlockRenderContext`, so `ctx` is
typed without every block naming a context type of its own.

Breaking, in an experimental package:

- `BlockRenderArgs.slots` is replaced by `BlockRenderArgs.renderSlot`.
- `BlockDefinition.resolve` is removed. Nothing ever called it, so a data-loading
  function written against it silently never ran; blocks read data through `ctx`.
- `createRevision`, `pruneRevisions` and `Revision` are removed from
  `@nextlyhq/plugin-page-builder`. They duplicated the content-versioning
  support that already ships in core, and nothing in the package used them.
