---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

A failure now chains the error it actually came from onto what the caller receives, through
every boundary that rebuilds one: REST routes, the Direct API, the singles route, the
plugin-facing collection facade, the bulk-by-query paths and the version writes. Previously
only typed failures carried their origin, and only on the Direct API, so a connection drop or
a constraint rejection arrived with nothing naming what actually went wrong. The status-derived
rebuilds — a code-less 404, 403, 409 or 500, which is exactly what a raw driver rejection
produces — dropped it too.

`NextlyError.notFound`, `.forbidden` and `.conflict` accept a `cause` alongside `logContext`,
matching `.internal`.
