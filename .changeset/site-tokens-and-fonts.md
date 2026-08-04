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
