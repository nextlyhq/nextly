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

A dashboard card asserted a meaning its own data did not have. The status
breakdown was generated for any collection carrying a field NAMED `status`, and
the schema permits an ordinary field of that name with the publishing lifecycle
switched off — so such a collection got a card titled "by status", describing
the split "between draft and published", over a column holding whatever that
author's field holds. It is now gated on the lifecycle capability itself, which
is what the health card beside it already read.

A chart's placeholder rows were told apart by styling alone. A bucket holding no
value and one holding the literal text `(empty)` were drawn in different colours
and announced identically, so the readers who most needed the distinction were
the ones without it. A placeholder now says what it is — "no value stored" —
rather than relying on italics. Exact separation is not achievable, because no
string can be reserved from a column of arbitrary text; what is fixed is that
the placeholder describes itself instead of depending on something a screen
reader never sees.
