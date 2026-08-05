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

Add endpoints for minting and revoking preview links.

`POST /api/nextly/preview-links` mints a link scoped to one entry, gated on `update` for that collection rather than on `publish`: someone who can edit an entry already sees its draft, so sharing a link to it grants nothing new, while requiring `publish` would break the workflow where an editor who cannot publish shows a draft to a reviewer.

`POST /api/nextly/preview-links/revoke` invalidates every link ever issued, including sessions already in flight. It is gated on `manage settings`, because the generation it moves is site-wide.

The mint returns a token rather than a URL, since where the preview route is mounted is the application’s decision.
