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
"@nextlyhq/plugin-api-docs": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Add OpenAPI documentation, delivered as a plugin. The new
`@nextlyhq/plugin-api-docs` generates a complete OpenAPI 3.1 spec at request time
from three derived sources — a filesystem scan of the app's route files (which
discovers mounts and their verbs, including the media double-mount), the admin
REST operations exposed by a new read-only `listAdminRestOperations()` seam, and
every registered plugin's routes via `listPluginRoutes()` — and serves it plus an
interactive Scalar reference, admin-gated by default. The error component is
generated from the live error-code enum, plugin routes can carry an optional
`openapi?` annotation, and the plugin exposes typed excludes (paths, services,
error codes) and explicit mount overrides. Core nextly gains only the two small
introspection seams on the plugin-sdk surface.
