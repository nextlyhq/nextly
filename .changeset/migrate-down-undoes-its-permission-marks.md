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

`nextly migrate:down` now undoes the rolled-back migrations' own changes to the permissions at every point, not only at the registry baseline's. A permission a rolled-back migration declared, which the point it returns to does not, is marked orphaned with its grants kept: rolling back a plugin release's permission-only migration withdraws the permission it added, and rolling back a migration that added a collection orphans the collection's permissions. A permission a rolled-back migration orphaned has its mark cleared where the point declares it; a plugin's, only while the plugin is installed and its configured release still declares it. A plugin installed after that point keeps what its install wrote, and the rollback adds and removes no grant.

**Plugin upgrades that change permissions:** a plugin release that only adds or removes a permission travels as a recorded migration written by `migrate:create`. `nextly migrate` applies it like any other, so the admin role holds a new permission before any start, and `migrate:down` of it orphans the permission with its grants kept.
