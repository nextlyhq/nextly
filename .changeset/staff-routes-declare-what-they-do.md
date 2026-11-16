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

Every plugin route now says what reaching it takes. A route declares at least one of `requiredPermission`, `public: true`, `principal`, `checksAccess: true` (its handler judges each caller itself) or `siteWide: false` (it acts only on the caller's own record, or only reads); `checksAccess` and `siteWide` stand alone. A route that declares none is refused with 403 for every caller, before any credential is read, and is named in a warning at startup. Before, such a route served anyone signed in, including an account with no role and an API key with no grants.

For plugin authors: add the declaration that matches each route. `undeclaredPluginRoutes(plugin)` from `@nextlyhq/plugin-sdk/testing` (and `nextly/testing`) lists the routes that still need one, so a test can keep it at zero. The first-party plugins are all declared.

The admin now tells a signed-in account with no role that it has no access yet, with "Check again" and "Sign out", instead of loading screens whose every request is refused.
