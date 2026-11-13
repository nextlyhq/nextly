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

Hold the Direct API's `nextly.login()` to what every other sign-in does.

- Its token is valid for 24 hours instead of 30 days. A token signed before this release keeps its 30 days, and still ends when its account's sessions are ended. A server that signed in monthly now signs in daily; a machine caller that wants a longer-lived credential uses an API key.
- Its token carries the account's roles in force, so `getSession` reads it with them, and it ends no later than the first of those roles expires. It used to carry no roles.
- Each call is recorded on the audit trail: a `login-succeeded` row naming the account, or a `login-failed` row naming none, both with `metadata.strategy: "password"` and `metadata.via: "direct-api"`.
- A deactivation, or an administrator setting the password, that lands while a login is running, after its password check, still ends the token the login issues.
