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

Plugin READMEs no longer tell you plugins are unavailable. Three plugins ship
today — the Visual Page Builder, SEO and the form builder — but the form
builder's README said "Plugins are not ready for use yet" and told you not to
rely on them in production, which is the page npm shows on the package. Every
plugin README now carries the same short alpha note and links to the stability
ladder, so you can see which surfaces are settled and which are still moving.

`@nextlyhq/admin-css` gains a README; it was published with a blank page on npm.

The plugin SDK's own source said dashboard widgets were "reserved, not
rendered". They do render, and are marked experimental only because the
contribution shape is still settling.
