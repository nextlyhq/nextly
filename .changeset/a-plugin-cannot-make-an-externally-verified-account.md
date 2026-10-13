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

A plugin can no longer turn an account into the kind core makes for a person another
system has verified: active, verified and without a password. Through
`ctx.services.users`, an update that would leave an account that way is refused with
`FORBIDDEN` and changes nothing: verifying an active account that has no password,
activating a verified one that has none, both at once, or reactivating one core made for
a verified person. Core makes those accounts only when one of the app's login plugins
hands it a sign-in. Such an account still takes a plugin's other edits, and a plugin may
deactivate it or give it a password, but may not move it to another address unless the
same write gives it a password. An active account with no password that is not
verified stays allowed.
