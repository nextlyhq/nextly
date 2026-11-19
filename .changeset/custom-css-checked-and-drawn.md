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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Custom CSS is drawn: a page's (`settings.customCss`) and each block's (`customCss`),
after the builder's own styles, the block's last, on the published page, in previews and
on the canvas. A block's CSS writes `selector` where the block goes, and the compile
scopes it to the block. One checker judges it, in the admin and on the server: it refuses
`@import`, any `url(…)` that isn't a path on the site, anything that would end the style
element and anything that can run script, naming the line. A stored value it refuses is
kept and not drawn.

To show custom CSS on your live site, add this line to your pages route (and to any
other route that draws page builder pages): `customCss: pageBuilderCustomCss()`,
imported from `@nextlyhq/plugin-page-builder`. A route without it draws no custom CSS.
The compile context takes the checker as `customCss`, which can also carry a site-wide
CSS drawn before the page's, and a route takes it as a `customCss` source (both
experimental).
