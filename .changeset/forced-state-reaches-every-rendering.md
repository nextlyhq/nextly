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

Preview an interaction state on every rendering of the selected block.

A block inside `core/collection-loop` is drawn once per entry, so one selected
node is many elements. The forced state reached only the first of them, which
outlined every row while showing the hover appearance on one.

A block whose render returns a promise now keeps its selection outline and its
previewed state. React commits the Suspense fallback first and the resolved
element later, and that second commit changes nothing the canvas was watching —
so selecting an image or a collection loop left it unmarked until an unrelated
edit happened to redraw it.

A page rendered with the preview turned off no longer inherits a stored site
sheet that had it on. The route's answer now wins in both directions, so a
page's own rules and the shared class rules cannot disagree about what `:hover`
selects.
