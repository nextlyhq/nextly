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

`hasRole`, `hasAnyRole`, `hasAllRoles`, `requireRole`, `requireAnyRole`, `requireAllRoles`, `checkCollectionAccess`, `checkPermission`, `authenticateApiKey` and the `AuthContext` type exported from `nextly/auth` are deprecated, and are removed in the next release. Each warns once, the first time it is called.

The role checks compare a user's role ids with role names, so they never match a role by its name. Check a permission instead with `nextly.access.check({ userId, resource, operation })`, which asks the same access decision every route uses, or use `isSuperAdmin(userId)`. In place of `checkPermission` and `checkCollectionAccess`, use `nextly.access.check` for a signed-in user. For an API key, check the key's own permissions, which `nextly.access.checkApiKey({ rawKey })` returns: `nextly.access.check` judges the user who made the key, not the key's narrower scope. In place of `authenticateApiKey`, use `nextly.access.checkApiKey({ rawKey })`, which authenticates the key and returns its permissions and roles; like `authenticateApiKey`, it applies no rate limit of its own.

The instance `getNextly()` returns now declares `access.checkApiKey`, which it already had at runtime, so the advice above compiles.
