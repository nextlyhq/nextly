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

feat(blocks-react): add the React renderer package boundary

Adds `@nextlyhq/blocks-react`, the React/RSC renderer for Nextly block
documents. This change lands the package and its layering guarantees; the
renderer itself follows.

The root entry imports no `next/*`, no admin code and no CMS runtime, so a
document can be rendered from a plain React app, a test or a script. Everything
Next-coupled lives at the `@nextlyhq/blocks-react/next` subpath, so importing
the renderer never pulls Next into a consumer's module graph. Both rules are
enforced by an allowlist-based import test rather than by convention.

`PageContext` and `BlocksDataProvider` are also introduced: the seam through
which data, media URLs and entry paths reach a block, so blocks never reach for
a database directly.
