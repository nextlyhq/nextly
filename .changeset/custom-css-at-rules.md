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

A site can define design tokens and self-hosted fonts, and the styling layer
emits both.

Tokens are dot-path names (`color.primary`, `space.4`, `content.width`) written
under a prefix the site chooses, `--site-` by default. `--nx-` and `--tw-` are
refused: tokens under either would restyle the admin interface or Tailwind's
internals as well as the site. Every token may carry a dark value, emitted
behind a `data-nx-theme="dark"` attribute the host controls, or behind
`prefers-color-scheme` where the site prefers to follow the operating system.

`content.width` ships in the default set, so editing one token re-widths every
centred container.

Fonts must be self-hosted. A `@font-face` pointing at another server makes every
visitor's browser announce its IP address to that server before the page can be
read, so a remote URL is a validation error naming the remedy — upload the file
and point `src` at a path on this site. A face that fails validation emits
nothing rather than half a rule, since a family whose file never loads renders
as the browser default rather than as the next family listed.
