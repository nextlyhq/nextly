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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(blocks-react): emit the site stylesheet, so design tokens resolve at all

`PageRenderer` gains an opt-in `siteStyles` prop that compiles the shared sheet
and emits it BEFORE the page's own, and `blocks-engine` gains
`resolveSiteTokens`, which layers a site's own tokens over the defaults by name.

Until now nothing in the repository called `compileSiteSheet`. The token
pipeline was built, tested and unreachable: `defaultSiteTokens()` was a default
nobody applied, and every `{ $token }` compiled to a `var()` with nothing behind
it. Three shipped blocks were broken by that and nothing reported it, because an
unresolved custom property makes the declaration invalid at computed-value time
and the property silently falls back to its initial value.

Order is the cascade: font faces, tokens and block-type defaults first, the
page's own sheet after, which is what lets a node's own value beat a class and a
class beat a block default.

Layering rather than replacing means a site supplying one brand colour does not
thereby lose `content.width` and `space.4`. This is the arrangement Gutenberg's
`theme.json` reaches — core defaults, then the theme's file, then the user's
saved styles — and a stored per-site override layers the same way, so the third
tier needs no new mechanism.

Opt-in rather than automatic: emitting token definitions unasked changes what a
stored token reference resolves to, and a page whose current appearance depends
on one dangling is a page that moves.
