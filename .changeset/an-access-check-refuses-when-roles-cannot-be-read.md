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
---

An access check whose role or permission read fails now refuses, instead of judging the caller as holding no roles or permissions.

- **Code-defined access rules** (collection and Single `access`, and field-level `access`) are handed the caller's roles and permissions. When those could not be read, a rule was handed empty lists. It is now not run: the request is refused with `DATABASE_BUSY` (503, retryable) when the read waited out `pool.connectionTimeoutMs`, and an internal error otherwise. A field rule whose caller's grants cannot be read is denied.
- **`listRoleSlugsForUser` and `listEffectiveGrants`** throw a `NextlyError` when the read fails, where they returned an empty list. A caller with no roles or permissions still gets an empty list.
