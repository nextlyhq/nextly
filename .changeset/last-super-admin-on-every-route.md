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

The last active super-admin is kept on every route. Removing the inheritance they depend on, replacing a role's `childRoleIds`, or deleting a role is refused when it would leave no active super-admin, as deleting, deactivating or taking the role from them already is. Every active super-admin counts, whether they hold the role itself or one that inherits it, as long as their assignment has no expiry.

Only a super-admin can take super-admin authority away from someone, by any role change: replacing their roles, unassigning a role, removing a role's inheritance, replacing its `childRoleIds`, or deleting the role. Anyone else is refused with `403`, including an API key made by a super-admin. Server code with no request caller is unaffected.

Creating a user with roles takes the same locks in the same order as deleting a role, so the two no longer deadlock when they run at once, which aborted one of them with a retryable `409`.
