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

Field-level write rules now apply to an anonymous write, not only an
authenticated one.

A collection may legitimately allow anonymous creates — a contact form, a public
submission. On one, a field declaring `access: { create: () => false }` was
enforced against every signed-in writer and skipped entirely for an
unauthenticated one, because the write guard treated "no user" as a trusted
system context. An unauthenticated writer could therefore set a field that every
authenticated user was forbidden from setting.

The guard now gates on `overrideAccess` alone, which is what the matching READ
guard has always done. An internal writer that needs to set a protected field
still says so explicitly with `overrideAccess: true`; that bypass is unchanged.
An anonymous writer resolves to no permissions and no roles, so a rule asking
for a grant refuses it.
