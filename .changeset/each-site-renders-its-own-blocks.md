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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Each site now renders its own blocks, and a public route needs no `blocks` resolver to draw them. The block registry is no longer one map shared by the whole process. Each page builder holds its own registry, fills it as its site starts, and judges and draws that site's pages with it. A route given no `blocks` reads the blocks of the site the process serves, custom ones included, even before anyone has opened the admin. A dev server's reload starts the site again with a fresh registry. A route that passes its own `blocks` still draws exactly those.

What changes for code that uses these packages:

- `@nextlyhq/blocks-engine` adds `createBlockRegistry()`, with the `BlockRegistry` and `BlockRegistryReader` types. The module functions (`registerBlocks`, `getBlock`, `allBlocks`, `clearBlocks`, `registryNestingSource()` and the rest) keep their names, but they now act on the calling bundle's own registry, which is what the admin's editor fills in the browser. They are no longer shared through `globalThis`, and the server's page builder no longer fills them. Code that read them on the server to learn the site's blocks reads `blocksOf(builder)` from `@nextlyhq/plugin-page-builder` instead, and a block registered with them on the server reaches no route and no save: register it with the page builder instead.
- `@nextlyhq/blocks-react` adds `SITE_BLOCKS_SERVICE` and `SITE_NAMED_QUERIES_SERVICE`, the names under which the page builder offers a site's blocks and named queries, `offeredSiteBlocks`, and `SITE_COPY` with `siteCopyOf`, the mark a site-bound value carries so a route knows whether its page builder started in that module copy. `createBlocksPage` and the other route factories read it when given no `blocks`, and refuse with a plain error when the site has no page builder, rather than drawing every block as unknown. `PageRenderer` still defaults to the bundle's registry, so a server render passes `blocks`.
- `@nextlyhq/plugin-page-builder` adds `blocksOf(builder)`, which binds a route to one site's blocks when a process serves several sites, and `loadSiteStyle` takes an optional `blocks` for the same reason; given none, it reads the started site's blocks and refuses when the site has no page builder. `blocksOf(builder)` refuses while no site has started, rather than answering no blocks. Both are marked, and where the builder did not start in the route's own copy of the plugin, as in a production build, the route reads the started site's blocks and named queries through the instance, so a production route also sees the named queries plugins declare. After a dev server's config reload, which makes new definitions and runs no `init`, the blocks field and `blocksOf` read the registry the running site started. `validateBlocksValue` now takes the site's registry as its fifth argument, before `breakpoints`. `BLOCKS_FIELD_TYPE`, the field type built with no site, now refuses to judge a page document rather than judging it against no blocks.

Two limits remain, both because a process keeps one set of plugin services and field types. A plugin that adds blocks in code from its `init` (`blockRegistry(ctx).register`) reaches the page builder whose site started last; blocks a plugin declares under `contributes.declarations` reach each site's own page builder. And while two sites run at once, a save is judged by the field rules of the site that started last, and in a production build `blocksOf` and `namedQueriesOf` read the site that started last.
