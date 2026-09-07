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

Stop publishing the retired category as an npm keyword.

`nextly`, `@nextlyhq/plugin-form-builder` and `@nextlyhq/plugin-seo` each
listed `app-framework`, so the category the project moved away from was
searchable on npm, where more people meet it than meet the repository.
`nextly@0.0.2-alpha.62` carries it today.

The platform keyword becomes `page-builder`, which is the half of the
descriptor npm had no word for. The two plugins simply drop it: neither is a
framework, and the keyword was describing the host rather than the plugin.
