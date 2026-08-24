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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

Give the page one measure instead of two.

A settings page decided its own width twice: `PageContainer` padded the panel
and `FormLayout`, rendered from inside each form, centred a `max-w` column and
padded again. The two disagreed by 24px, so a page's heading and its first form
card did not share a left edge.

`PageContainer` now takes an opt-in `width` and spends the inset as grid
columns, and `FormLayout` is gone. Its `56rem` and `72rem` were a hand-written
second copy of `--nx-measure-form` and `--nx-measure-wide`, free to drift the
moment a theme retuned either token. `FormActions` is unchanged and now sits at
the page's measure rather than the layout's.

Omitting `width` keeps the container the padded block it has always been, which
is what the pages that manage their own height depend on.
