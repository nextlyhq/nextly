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

A font weight is checked as CSS reads it rather than as JavaScript converts it.
`0x190` becomes 400 on the way through a numeric conversion and passes any
bound applied afterwards, while the string kept in the descriptor is still
`0x190` — which CSS cannot parse, so the browser drops the declaration and
matches the face at a weight nobody chose. The exponent and fraction forms CSS
does accept, such as `1e3` and `.5e3`, still work.

Choosing the same font file twice in a row works. A file input is uncontrolled,
so clearing the panel's own state left the element still holding the previous
choice — and a browser raises no event for an unchanged selection, which left
the Add button disabled while the picker displayed the very file just chosen.
Adding one variable font's italic after its upright is that flow.
