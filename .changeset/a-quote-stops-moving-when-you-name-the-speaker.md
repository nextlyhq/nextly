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

Typing an attribution on a quote moved the quotation. A user agent indents a
`<blockquote>` about 40px, and in the attributed shape that margin sat inside
the block's own indent and added to it — so the same quote drew at 24px bare and
64px attributed, in any site without a CSS reset. Both now draw at 24px.

An image's caption drew at the body's own size directly beneath the picture, so
it read as another paragraph that happened to follow an image rather than as a
caption.

A form's fields did not group. One even gap separated a label from the control
it names and one question from the next, so nothing read as belonging together —
a label sat as far from its own input as from the next field entirely. The gap
is now the distance from a label to its control, and the control states the
distance to the next field.
