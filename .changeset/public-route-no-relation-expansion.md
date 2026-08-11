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

A public content route no longer expands relations by default.

A trusted read propagates both its trust and a widened lifecycle into
relationship expansion: a populated target is read with access rules bypassed
AND `status: "all"`. At the inherited default of `depth: 1`, a page in a public
collection could therefore embed a draft or access-restricted row from a
collection appearing nowhere in the route config — and a public route
pre-renders that into a static artifact.

`createPublicContentRoute` and `createPublicBlocksPage` now default to
`depth: 0`. Setting `depth` explicitly restores expansion, and states that the
populated collections are public too.
