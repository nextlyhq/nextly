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

The Direct API's role, permission and field-group writes honour `overrideAccess: false`, set on the call or on the instance, as the REST routes do. `nextly.roles.create`, `update`, `delete` and `setPermissions`, `nextly.permissions.create` and `delete`, and `nextly.fieldGroups.create`, `update` and `delete` ask the permission the matching route asks:

- roles: `create-roles`, `update-roles` (also for `setPermissions`) or `delete-roles`;
- permissions: their own action, or `manage-permissions`;
- field groups: their own action on `settings`, or `manage-settings`.

A super-admin passes. An API key is judged by its own grants. A checked call that names no `user` is refused with `AUTH_REQUIRED`.

Compatibility: only calls that ask to be checked change. Trusted calls, the default, behave as before.
