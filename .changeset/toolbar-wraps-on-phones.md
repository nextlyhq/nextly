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

The document header no longer overflows on a phone.

Collapsing labels recovered enough width for the title down to about 540px, and
below that there is simply not enough room for a title and a row of controls
side by side: even with every label already reduced to its icon the cluster
needs around 370px, against 294px of usable width on a 390px screen.

So below 32rem the header wraps instead. The title takes its own line and the
controls sit beneath it, wrapping among themselves rather than running off the
edge. Nothing is hidden and nothing is clipped; the header is taller on a phone,
which is the dimension a phone has to spare.
