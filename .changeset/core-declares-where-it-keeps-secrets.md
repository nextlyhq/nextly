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

Core now declares, for every one of its tables, whether it holds a secret and where: password-reset, invitation and email-verification tokens, signed-in sessions, API keys, one-time links and codes, the setup token, the audit digest key, lock and claim tokens, an email provider's settings, queued emails, a webhook's signing secrets and headers, and the plugin settings a plugin marked secret. A password hash is declared as sign-in data, left out unless an encrypted archive is asked to carry it. Internal for now: a guard that drops these before a row leaves the site, refusing a table nobody declared and a row keyed by anything but column names, and a scan that finds a known value in a writer's output as written or encoded. A test fails when a core table is added without saying whether it holds secrets.
