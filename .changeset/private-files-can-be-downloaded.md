---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Private files can be downloaded (experimental). `GET /admin/api/files/:slug/:id/download` reads the file's entry as the caller, by the collection's access rules, and answers a file they may not read, a missing one and one not yet confirmed with the same 404; a ready file is streamed as an attachment, or answered with a 303 to a link that lasts a minute, and no cache may keep either. Every download writes an audit row of kind `file.downloaded`. Server code opens files with `nextly.files.download`, which refuses a call naming no caller unless it says `overrideAccess: true`. Two confirms of one upload that overlap now keep one copy of the file. A response's own `Content-Security-Policy` and `Referrer-Policy` are no longer replaced by the site's defaults. New guide: Private Files.
