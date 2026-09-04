---
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/admin": patch
"@nextlyhq/builder": patch
"nextly": patch
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
