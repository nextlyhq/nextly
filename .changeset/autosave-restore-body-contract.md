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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

fix(admin): send the autosave snapshot as the request body

Restoring a recovery point put nothing back in the form.

The autosave endpoint treats the request BODY as the snapshot and reads the
locale from the request params. The client wrapped the values in an envelope
instead, so that envelope was stored as the snapshot and every field ended up
one level too deep; a restore then wrote an object with no field names the form
recognised. The locale it carried in the body was never read.

Also enables drafts and autosave on the playground posts collection. No
collection there or in any template enabled it, so the policy gate refused every
write and nothing had ever exercised the path.
