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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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
"create-nextly-app": patch
"nextly": patch
---

Run `nextly upgrade` after updating. Roles that held manage-settings, manage-media or manage-email-\* keep their access only once it has run.

`manage-media`, `manage-settings`, `manage-email-providers` and `manage-email-templates` are retired in favour of the plain read, create, update and delete permissions there. `nextly upgrade` gives each role holding one the plain four on that resource and takes the `manage-` permission off, once. Until a role is converted, each start names it, with the command to run. Setting, creating or updating a role with one of these `manage-` permissions now stores the plain four instead, which gives the same access, and so do role presets and the super-admin seeder at each boot. `manage-background-jobs` is unchanged.
