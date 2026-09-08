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

The gutters in `core/columns`, `core/gallery` and `core/accordion` follow the
site's spacing token again instead of a hard-coded length.

All three shipped with `{ $token: "space.4" }`, rendered their children
touching, and were changed to a literal `1rem` for it. The cause was not the
token: the renderer withheld the token tier from a consumer handing back a
stored stylesheet, so the reference arrived as a `var()` with nothing behind it
— invalid at computed-value time, and `gap` falls back to `normal`, which is
zero for a grid.

That path now carries the declaration, so the reference resolves and a site that
redefines `space.4` moves all three. The rendered value is unchanged for a site
that does not: measured in a browser on the path that used to fail, the computed
`column-gap` is `16px` and the space between two columns is 16 pixels.
