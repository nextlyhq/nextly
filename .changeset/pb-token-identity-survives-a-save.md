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

A design token's stable identity now survives a save, and the tier merge keys on it.

The stored-tokens write validator rebuilt each token from a field allowlist, so
an `id` written through the editor was dropped on every save — a rename appeared
to work while the identity keeping existing references resolving was gone. The
id is carried through, and refused rather than dropped when it is not a string.

`resolveSiteStyle` merged the config and stored token tiers by name while the
engine resolves by identity. A renamed stored token therefore stopped matching
its config counterpart and the default survived beside it, leaving a stale entry
in the list every studio reads. Both stages now key on `tokenIdentity`.
