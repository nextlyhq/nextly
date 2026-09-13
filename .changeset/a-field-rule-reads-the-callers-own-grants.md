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

A collection's field rules are judged on the authority the caller arrived with.

An API key carries the grants stamped on the key, deliberately narrower than the database roles of whoever owns it, and the collection write paths did not pass that scope to the field-level pass. A rule reading `permissions` was therefore answered from the key owner's roles. It reads as a permission bug in both directions: a key stamped with exactly the grant a rule asks for could not write the field, and the write reported success while dropping the value, while a key owned by a privileged user was judged on authority the key was never given.

Every collection write path passes the caller's scope now, on create and on update alike. The Singles path already did.
