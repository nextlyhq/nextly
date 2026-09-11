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
"@nextlyhq/plugin-form-builder": patch
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

A plugin route can now ask what its caller may do, not only who they are.

`ctx.caller` carries `authMethod`, the authenticating `apiKeyId`, the token's
verified `claims`, and `can(action, resource)` — answered through the same
machinery that decides a route's own `requiredPermission`: a scoped API key on
its own stamped grants and the code-defined rule evaluated against them, and a
session through the RBAC service with its super-admin bypass. A super admin does
not bypass an API key's scope.

This is additive and changes no existing behaviour. It exists because
`ctx.authenticatedScope` answers only for API keys — a session caller's grants
are resolved on demand and it holds no stamped scope — so a route could not ask
"may this signed-in author create in collection X", which is the question an
admin panel needs in order to gate a create action before showing it.

Deliberately not a permission array: a session's is empty by design, so a route
reading one would refuse every signed-in user while appearing to check
something. The write remains the enforcement point; this is a UX and routing
aid.
