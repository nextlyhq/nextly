---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Publishing a collection document now requires the publish permission.

A write that moves a document into published needs `publish-<slug>`, and one
that moves it out of published needs `unpublish-<slug>`, on top of the update
permission — editing and publishing are separate capabilities. This is enforced
on every collection write path, including single updates, batch updates,
creating a document directly as published, and the publish-all-languages action.
A caller with only update can still edit and save drafts, but can no longer make
content public. Trusted server writes (overrideAccess) are unaffected.
