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

Scroll a tab strip without making the strip itself the scroller.

A tab list that carried its own `overflow-x-auto` became a scroll container on
BOTH axes, because CSS computes `visible` to `auto` when the other axis is not
visible. The trigger's underline is drawn by a 2px pull-up onto the list's rail,
so that pull-up was then reported as vertical overflow and the strip grew a
stray vertical scrollbar it had no use for. `TabsList` now takes a `scrollable`
prop that puts the scroll container in a wrapper, leaving the rail intact and
letting it span the full scroll width.
