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

`nextly migrate`, and a start, no longer tell a database that an earlier release migrated but never started that its visitors lost reads. Since 0.0.2-alpha.75 `nextly migrate` makes the preset roles, so a database it migrated, with no start since, read as one seeded by a release from before the Public role, and was told "Before this upgrade they could read these" of collections and Singles with no read rule, which its visitors could not read before the upgrade either. A database whose preset roles' grants a release recorded (`preset_grants_release`, written only by `nextly migrate` from 0.0.2-alpha.75 on) is now recorded as not due the notice. A database seeded by a release from before the Public role is still told once. Only the notice's own record changes: no role, permission or grant is touched.
