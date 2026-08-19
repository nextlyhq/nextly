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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch

The editor canvas drew every block flush and unstyled while the published page drew the author's
real spacing. An author setting a margin, a height or any other per-node style saw nothing change
until they published.

Node styles are a SEPARATE tier from the site sheet, and `PageRenderer` compiles them only when it
is handed a style context. The public routes pass one; the editor never did. The failure is silent
by construction rather than loud: `resolvePageStyles` withholds the sheet and keeps the class names,
so every block carried its `nx-pb-<hash>` class and nothing defined it — the markup looked correct
and the page looked unstyled.

Measured both ways on one document, with the style context the only variable: without it, zero
scoped rules, zero gaps between siblings and a spacer collapsed to zero pixels; with it, six rules,
24px gaps and the spacer at its authored 48px. That collapse is also why dragging felt broken —
the 2px drop indicator had no gap to draw into and landed on top of flush text.

The breakpoints come from `siteBreakpoints()` rather than a set spelled at the call site, because
`site-style.ts` exists so the field validator and the canvas cannot disagree about what this site's
breakpoints are. The canvas is now its third consumer.
