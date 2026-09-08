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

A font this installation agreed to store could not be served. The public byte
route bounded its read with a constant while `security.limits.fileSize` is
configurable, so a deployment accepting 20mb stored a 12MB font and then
refused it on every request — permanently, and with a status the author cannot
act on. The route now reads up to the same number the upload policy allowed,
which is the only defensible bound: below it the product declines to hand back
what it took.

A missing media row is also identified by the cross-realm brand rather than by
`instanceof`. A route handler and the shared media service can be instantiated
from different server bundles, and two copies of the package are two distinct
classes — so an absence raised by the other copy escaped to the generic
handler, which answers with a structured document, while a present-but-private
row answers with a blank 404. Telling those two apart is what the route exists
to prevent.
