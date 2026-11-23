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

Private files can be uploaded (experimental). `POST /admin/api/files/:slug/uploads` checks the caller may create in the collection, judges the file's name, type and size against its `files` option, and answers a link that lasts five minutes for sending the bytes straight to storage; `POST /admin/api/files/:slug/uploads/:id/complete` reads the stored bytes back and accepts them only when their size and content match what was claimed, deleting them otherwise. Staff, API keys (by their own scope) and signed-in people of the kinds a collection lists in the new `files.principals` are judged by the collection's access rules alike. Uploads never confirmed are rejected and their bytes deleted once the collection's wait has passed, by a job the job runner runs. An app whose private collection has no storage that keeps files private now refuses to start.
