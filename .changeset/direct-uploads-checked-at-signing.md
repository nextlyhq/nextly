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

A signed direct upload (`clientUploads`) is now checked before it is signed. Its name, extension, type and size go through the same checks and settings as any upload, an SVG is never signed (it goes through the standard upload, where it is sanitized), and the extension must name the claimed type. The S3 signature now binds the type and the exact size, so S3 refuses any other file, and a requested `expiresIn` is honoured up to the configured lifetime. Callers of `POST /api/nextly/storage/upload-url` must now send the file's `size`, and Direct API callers pass `{ size }` to `nextly.storage.getClientUploadUrl`. Vercel Blob no longer reports client-upload support it never had.
