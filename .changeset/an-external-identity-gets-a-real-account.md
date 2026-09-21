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

`createExternalUser` creates an active, email-verified account with no password,
for an identity a trusted provider has already verified. A passwordless
`createLocalUser` makes an inactive invite carrying a set-password link, which
is the wrong shape for someone who has just signed in with a provider.

It refuses two things as policy. It will not create the first account on an
install, because that account decides who administers the site and a login
provider must never be what mints it. And it will not assign the super-admin
role, so the highest privilege is never reachable by arriving through a
provider.

Roles are validated and assigned inside the same transaction as the account.
`createLocalUser` assigns them afterwards and swallows failures, which can
leave an active account holding fewer privileges than it was created with and
nothing to say so.
