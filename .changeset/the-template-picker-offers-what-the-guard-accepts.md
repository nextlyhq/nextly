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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A new template's Collection choice in the page builder's template form now offers exactly the collections the template guard would let a template draw, answered by a new `GET /templates/collection-choices` route instead of inferred in the browser from the fields visitors can read. The route asks the guard's own rule of each collection the caller may read, so a collection whose `slug` field is not text is no longer offered and then refused on save, even where its `slug` is hidden from visitors; the page builder's own collections, Pages among them, and collections kept out of the admin are left out by the same rule. Only a caller who may create or change templates is answered, and that is asked before anything is read; a collection the caller may not read is never judged or named. The form's collection reads are asked again on every mount, and a cached answer is no longer shown while that refresh is in flight, so a collection added, removed or changed since is offered, or not, only once the fresh answer says so. The form no longer reads the pages collection's slug for this.
