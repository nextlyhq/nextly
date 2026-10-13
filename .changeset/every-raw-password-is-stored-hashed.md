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
---

Every raw password is now stored hashed, whatever it looks like. Creating an account
decided from a password's shape whether it was already a hash, and stored one of 32
characters or more containing a colon as given, in plain text. Self-registration, the
admin, the Direct API, plugins and setup all reached it.

A password given to create an account is always hashed. A value that is already a hash
is taken only by the write meant for one (`PATCH /api/users/:id/password`), which now
refuses anything that is not a hash. Sign-in refuses a stored value that is not a hash,
without comparing it; no such value ever matched a password, so no working sign-in is
lost. A ready-made hash given to account creation is hashed again, as it already was.
