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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The block document format no longer has a `region` kind. A Layout's header and footer have always been components, so nothing in Nextly wrote a `region` document, and the format now has four kinds: `page`, `pattern`, `component` and `template`.

- A blocks field can no longer declare `kinds: ["region"]`. A field that still lists it, in code or in the Schema Builder, stops the app from starting with a message naming the field, until `region` is taken out of its kinds.
- Saving a document with `kind: "region"` is refused, and strict validation reports it as an unknown kind. One already stored still renders, but can't be edited.

If you stored one through the API yourself, first change the field's kinds to include `component`, then save the document again with `kind: "component"`, keeping its blocks.
