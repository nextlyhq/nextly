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

Pages is listed once, with the rest of your content.

The page-builder plugin contributed a "Pages" menu entry pointing at a
collection the Collections listing already offered, so the same screen appeared
under two names. The entry is gone; the menu now holds the three libraries —
patterns, components and layouts — which are the pieces pages are built from and
are genuinely global.

It was also a claim the code does not support. The page builder is a FIELD TYPE:
any collection may declare `blocks` and a Single may too, and nothing in the
engine, the builder or the plugin knows the slug `pages`. A menu promising that
the page builder means Pages gets less true the moment a second collection
declares the field, and nothing would ever have added that one.

Switching page while building is unaffected — the editor's own left rail carries
a Pages panel, which is where that job belongs.

A note repeated in the three library collections is corrected at the same time.
It claimed two automatic navigation sources reach them and that plugin ownership
cannot move a duplicate. Only one source reaches them, because the other lists
`admin.isPlugin` collections and this package never sets that flag; and declared
PLACEMENT does move a listing, which is the distinction ownership and placement
are separate questions about.
