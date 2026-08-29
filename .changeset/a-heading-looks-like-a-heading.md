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

Give headings and paragraphs a typographic baseline, and let a site's own CSS
override a block type's defaults.

Under a host's CSS reset an `h1` and an `h3` differ only in tag name, so a
correct document rendered as undifferentiated text. Block defaults could not fix
it: they are keyed by block TYPE and a heading's level is a PROP, so one
`core/heading` default gives every level the same size. The compiler now accepts
`elementBases`, keyed by element, and `blocks-react` supplies a baseline for
`h1`–`h6` and `p`.

Both default tiers are anchored to a single page-root class with the rest of the
selector inside `:where()`. That weighs one class: enough to clear a bare
element reset, and still below a host's own class rule, so a default remains
something a site can override. Previously block defaults carried the doubled
page-root prefix that exists to make an AUTHOR's values outrank host CSS.

The heading scale is sized in `em`, which is what lets an author's typography
reach a heading at all. These defaults are rules ON the element, while a page
setting or a block's own value arrives by inheritance, and a direct rule beats
an inherited one whatever either weighs — so a page set to `20px` left every
heading at its default size. In `em` the default is a multiple of what was
inherited instead of a replacement for it: the same page now gives an `h1`
`45px`, while a document that sets nothing is unchanged and a site's own
`.content h1` still wins.

`TYPOGRAPHY_DEFAULTS` and `withTypographyDefaults` are exported so a host can
replace the baseline.
