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

Each system list and its dashboard count read who may see that list from one definition.

The users, roles, permissions, media, field-group and API-key lists each declare their read gate once, in `auth/list-read-gates`, and say how it is checked as well as what it asks. The list routes and the dashboard summary's counts both read those gates and check them the same way, so a count can no longer be given to a caller its list refuses, or kept from one it admits, after a change to only one of them. The API-key list's reach (every user's keys) is declared there too, and the key count covers what the list shows.

No caller's answer changes. The permissions count is now checked through the any-of check the permissions list uses, rather than the single-grant check. For an API key and for a session the two agree on `read-roles`.
