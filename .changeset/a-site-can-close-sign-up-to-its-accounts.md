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

A site can close sign-up to its accounts, and its own code can end an account's access. `@nextlyhq/plugin-accounts` takes a `signUp` option, `"open"` by default so an existing site is unchanged; `"closed"` refuses every sign-up with `ACCOUNTS_SIGN_UP_CLOSED`, through the server function, the REST endpoint, the server action and another plugin's service alike, before reading anything sent, so no address is revealed and nothing is emailed. The server functions gain `endAccountSessions`, `deactivateAccount` and `reactivateAccount`, which take an account's id and do what staff's actions of the same name do, each recorded in core's audit log under its own `nextlyhq-plugin-accounts.app.*` kind.
