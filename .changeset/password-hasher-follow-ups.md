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

The admin's password forms check the password rule the server publishes on `/auth/setup-status`: the configured minimum length, and the byte limit of the app's `auth.passwordHasher` (none where the hasher reads a password whole). Before, they always applied 8 characters and bcrypt's 72 bytes, so an app with an unbounded hasher could not set a longer password from the admin, even though the server accepts one.

`nextly users:clear-plaintext-passwords` and `nextly migrate` now load the config, and never count a stored value that the configured `auth.passwordHasher` recognises. `--confirm-default-hasher` now states that every stored password was written by core's bcrypt or by that configured hasher.
