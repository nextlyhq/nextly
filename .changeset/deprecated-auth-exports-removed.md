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

Removed from `nextly/auth`, deprecated in 0.0.2-alpha.69: the role checks `hasRole`, `hasAnyRole` and `hasAllRoles`, the guards `requireRole`, `requireAnyRole` and `requireAllRoles`, `checkPermission`, `authenticateApiKey`, `checkCollectionAccess`, and the session `AuthContext` type. The role checks compared role ids with role names, so they never matched. To ask whether a signed-in user may do something, use `nextly.access.check({ userId, resource, operation })`; for an API key, use `nextly.access.checkApiKey({ rawKey })`, which judges the key on its own permissions; for super-admin authority, use `isSuperAdmin(userId)`. The error helpers `createErrorResponse`, `createJsonErrorResponse` and `isErrorResponse` stay.
