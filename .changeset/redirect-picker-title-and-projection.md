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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Form redirect picker: list target documents by the field each collection configures as its title, and project the read it already claimed to project.

A collection that sets `admin.useAsTitle` to a field such as `headline` was neither asked for that field nor labelled by it, so every choice in the picker fell back to an opaque id and an author could save a redirect to the wrong page. The picker now reads each target collection's configured title field and lists by it, keeping the conventional names as fallbacks.

The same request also sent its field projection as a comma-separated list, which the API parses as JSON and discards on failure — silently, returning every scalar and JSON field of up to fifty documents per collection. For page-builder targets that is the entire block tree, downloaded to fill a dropdown that reads five fields. The projection is now encoded in the form the API accepts.
