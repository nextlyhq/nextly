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

Every counter in a document now says what it is counting. The language panel
read "0 of 2 translated" while translation mode read "0 of 2 fields translated"
a few clicks away, and with three languages and two translatable fields the two
numbers coincide exactly where a person first meets them. The panel now names
its unit like the other three do, so the shape is the same everywhere: "N of M
languages translated", "N of M fields translated".

Field names are resolved in one place. The form printed "Excerpt", the entry
list printed "Excerpt" through its own second copy of the humaniser, and other
surfaces printed the raw key `excerpt` — the same field with two names, and the
raw key is the one a translator cannot act on. `fieldLabel` and
`humanizeFieldName` now answer that once, and treat kebab and snake keys alike:
`user-email` was coming out "User-email" from one of the copies.
