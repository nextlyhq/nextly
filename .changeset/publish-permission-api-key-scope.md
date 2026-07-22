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

Scoped API keys are now judged on their own grants when publishing.

A REST write authenticated with an API key is authorized at the route only as
`update`, so the service-side publish/unpublish gate previously fell back to the
key owner's permissions. An update-only key owned by a publisher could publish,
and a publish-scoped key owned by a non-publisher was refused. The publish
transition now judges the key's own stamped scope for both collections and
singles, matching how reads already work.
