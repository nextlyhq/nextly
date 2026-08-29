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

Show the right blocks when previewing an interaction state.

Focus no longer lights up a selected block's ancestors. `:hover` and `:active`
match an element and every ancestor of it, but `:focus-visible` does not — that
is `:focus-within`, which the builder does not emit. Previewing focus therefore
showed an enclosing block's focus styles for an appearance no visitor sees.

Page-level state styles now apply in the preview at all: the marker is put on
the rendered page root, which is what those rules select, rather than on the
canvas wrapper around it.

Each interaction state's meaning is defined once and both the published and
preview selectors are derived from it, so the two cannot drift into matching
different pseudo-classes.
