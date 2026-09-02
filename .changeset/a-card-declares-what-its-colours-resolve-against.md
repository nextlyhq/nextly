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

A page rendered from a stored stylesheet drew its cards as hard boxes in the
text colour, with no fill.

A consumer with no write path compiles a page once, stores the CSS and hands it
back to the renderer. That artifact still carries every `var(--site-*)` it was
compiled with, and the renderer withheld the whole site sheet whenever the
site's breakpoints were not stated — so nothing declared those custom
properties. An unresolved `var()` makes its declaration invalid at
computed-value time, which drops each property to its INITIAL value rather than
the site's: `transparent` for a background, and `currentColor` for a border.

The withholding guarded the block-default and named-class tiers, which are
emitted under the at-rules a site's breakpoints imply. It reached the token tier
as well, which declares `:root { --site-*: ... }` and reads no breakpoints at
all. Those tiers are now separated, so a page compiled without stated
breakpoints still receives the declarations its own CSS references, and pages
that emit no stylesheet still receive nothing.
