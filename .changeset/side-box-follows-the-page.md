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

Margin and padding now read as the box they describe. Instead of four stacked
rows — Block start, Block end, Inline start, Inline end — the four sides are
drawn around a small diagram, so which edge each value belongs to is something
you see rather than something you read.

The diagram follows the page being edited, not the admin. On a right-to-left
site the inline start is the right-hand edge, and that is where the control for
it appears, even while the admin itself is in English. Where the page cannot be
measured — before the canvas has drawn, or while a block is still loading — the
four labelled rows are shown instead, because a diagram that might be pointing
at the wrong edge is worse than words that cannot be.
