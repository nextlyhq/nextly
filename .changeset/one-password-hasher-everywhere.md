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

An app's `passwordHasher` is now the one scheme for every account password. Creating an account, an administrator setting a password, a person changing theirs, a reset link, an invite, the first password and every sign-in all hash or check with it; before, only the users service's `authenticate` and `changePassword` did, so a password one path wrote could fail to sign in through another. It can now be set in the config as `auth.passwordHasher`, which every way Nextly starts reads (a request to the route handler starts Nextly without `getNextly`'s options). A hasher may declare `isHash`, so a stored value that is neither its own nor bcrypt is never compared. Accounts that already hold a bcrypt password keep signing in, and the first sign-in stores the password again with the app's hasher, keeping its sessions and when it was set. Without a hasher nothing changes: core's bcrypt, as before, and `authenticate` and `changePassword` no longer fail with an internal error.
