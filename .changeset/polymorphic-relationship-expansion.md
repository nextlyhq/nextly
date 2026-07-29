---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/eslint-config": patch
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

Populate relationships that point at several collections. A field declared with
a list of targets stores its value as a `{ relationTo, value }` pair, and
expansion treated that pair as if it were a plain id while resolving the table
from the field's first declared target. The resulting query bound an object
where the driver expected a string, failed, and the failure was discarded, so
the field came back as its raw pair at every depth with nothing logged.

Values are now loaded from the collection each one names, on single reads,
listings and nested hops alike, and a populated row is redacted by that
collection's own field rules.
