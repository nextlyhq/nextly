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

The super-admin assignment rule now applies to every role change requested through Nextly's REST routes. There, only a super-admin can assign the super-admin role or a role that inherits it, create or update a user with such a role, or make a role inherit one, whether by adding inheritance or through `childRoleIds` when a role is created or updated, and an API key cannot, whoever made it. Server code such as a seed or the CLI is unaffected.

A role created through `POST /api/roles` can no longer be marked `isSystem: true`. That request now answers 400. System roles are the ones Nextly seeds itself.

Assigning a role through `POST /api/users/:id/roles` now answers with what happened: `404` for a user or role that doesn't exist, `409` for a role already held, and `400` for an `expiresAt` that isn't an ISO date and time. A user created with roles is created with all of them or not at all.
