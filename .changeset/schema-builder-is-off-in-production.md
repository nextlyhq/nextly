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

The schema builder is now off in production, whatever `admin.branding.showBuilder`
says. A production server refuses every builder save, preview, repair and delete with
`BUILDER_DISABLED`, and the admin offers no builder there. Schema reaches production
through migrations: make the change in development, commit it with its migration, and
let `nextly migrate` apply it. A production start that finds `showBuilder: true` logs
once that the setting has no effect there.

Two saves made in code are refused in production the same way: a field group's
create, update or delete through the Direct API (`nextly.fieldGroups`), and a plugin's
collection create, update or delete through `ctx.services.collections`. In
development both go ahead as before.

Entry writes are unaffected everywhere. Outside production, `showBuilder: false` still
turns the builder off, as before.
