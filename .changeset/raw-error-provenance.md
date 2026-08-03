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

One place now builds the error response body, so plugin routes answer with what every other
route answers with. Three consequences for a plugin route:

- Failures now carry `_devDiagnostics` in development, which this surface never had.
- A handler that throws a non-`NextlyError` still answers 500, but the thrown error is now
  chained onto it instead of discarded.
- A 401 or 403 now returns the canonical `{ error: { code, message, requestId } }` body with
  `application/problem+json`, matching the rest of the API. It previously returned the legacy
  `{ data: { ... } }` body with `application/json`, so a single plugin route answered rejected
  requests and failing handlers in two different shapes. A client reading a plugin route's
  auth-failure body needs updating; one reading the status or a handler failure does not.
