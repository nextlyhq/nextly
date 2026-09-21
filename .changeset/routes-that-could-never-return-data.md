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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

**Breaking.** The account-link endpoints are removed:
`GET /api/users/{id}/accounts` and
`DELETE /api/users/{id}/accounts/{provider}/{providerAccountId}`, along with
the `getAccounts`, `deleteUserAccount` and `unlinkAccountForUser` service
methods behind them. They read an `accounts` table nothing has written since
the auth rewrite, so they could only ever answer with an empty list or a
not-found, and a route that cannot return data invites clients to build
against it.

The relational `query` namespace is also gone from the plugin-facing database
type. It named a handful of core tables, so it could never answer about a
plugin's own tables; reads go through the fluent Drizzle API or the typed
services.

External identities are not affected: they are the subject of the plugin
identity tables that arrive with the auth plugin, not of this table.
