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
"@nextlyhq/plugin-form-builder": patch
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

A plugin route now authorises against the API key's own scope, not its owner's grants

**What changes for a host.** A request that reaches a plugin route with a scoped
API key is now judged on that key's own stamped permissions. Previously the
route received only the key OWNER's identity, so a deliberately read-only key
could drive any write its owner was allowed to make through any plugin route
that offered one. This never exceeded the owner's access — it is not a privilege
escalation across identities — but it is exactly the guarantee a scoped key
exists to provide.

**Expect requests to start failing that previously succeeded**, and that is the
fix: an API key calling a plugin route that uses `ctx.services.collections` with
`{ as: 'user', user: ctx.user }` now receives a `FORBIDDEN` error when the key's
scope does not include that operation on that collection. Audit any integration
driving a plugin route with an API key and widen the key's scope, or mint one
with the grants it actually needs. Session-authenticated requests are unchanged,
and `{ as: 'system' }` elevation is unchanged.

**New on the route context.** `ctx.caller` carries what the caller may DO
alongside `ctx.user`, who they are: `authMethod`, the authenticating
`apiKeyId`, the token's verified `claims`, and `can(action, resource)` — which
answers through the same machinery a route's own `requiredPermission` is
decided by. A super admin does not bypass an API key's scope; that bypass
belongs to the session path.
