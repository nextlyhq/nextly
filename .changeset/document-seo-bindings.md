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

A builder document can state its own title, description and social image in `settings.seo`. A text value is a list of literal text and bindings, joined in order: an entry's title, then the site's name. The image is one binding, to a media field or a URL field. The page's binding pass fills each binding with the same checks, format and fallback a text prop's binding gets, so a collection template gives each entry's page its own metadata. A stated value wins over what the blocks offer, in `metadata`'s `derived` argument. The validator refuses a malformed value, a list item as a source, more than 32 segments and literal text over 1,000 characters (`invalid-seo`). `resolveDocumentSeo` is exported from `@nextlyhq/blocks-engine`.
