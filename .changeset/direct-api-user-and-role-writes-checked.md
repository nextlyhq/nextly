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

The Direct API's user and role writes (`users.create`, `users.update`, `users.delete`, and `roles.create`, `roles.update`, `roles.delete`) now honour `overrideAccess: false`, set on the call or on the instance. Each is checked as the named caller against the same permission the matching REST route asks for, and refused with `FORBIDDEN` when the caller lacks it, before anything is written. A checked call that names no user is refused with `AUTH_REQUIRED`. A role change made this way follows the same super-admin rule as REST: only a super-admin may give anyone a role that is, or inherits, super-admin. An API key is judged by its own grants. Trusted calls, the default, are unchanged.
