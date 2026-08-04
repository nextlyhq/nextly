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
---

Custom CSS can use `@keyframes` and `@font-face` again.

Both were dropped wholesale because the name each defines is resolved for the
whole document, however tightly the rules around it are scoped — so two page
builder documents on a page, or a document and its host, that both define
`fade` do not get one each. For `@font-face` it went further: family names match
case-insensitively, so declaring `Inter` from inside a scoped region would have
replaced the font the host renders its whole site in.

The names now carry the scope's namespace, and your own references to them are
rewritten to match, so you write `fade` and `MyFont` and they work. A name your
CSS does not define is left alone, which means you can still reference an
animation the page itself provides.

`@font-face` still may only load a font from this site's own origin, and a rule
left without a usable `src` is removed rather than left declaring a family that
resolves to nothing.
