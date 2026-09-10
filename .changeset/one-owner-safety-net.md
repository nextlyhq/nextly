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

Update and delete cannot disagree about who owns a row.

Both write paths fall back to comparing a fetched row's owner against the
caller when the SQL owner predicate is absent, and each decided that inline.
Update knew that a scoped API key is judged on its own stamped grants and so
does not inherit its owner's super-admin bypass; delete did not. A key owned by
a super-admin could therefore delete a row it does not own, while the same key
could not update one.

The fallback is reachable rather than theoretical: the owner constraint answers
`null` when a metadata read fails, which leaves the predicate off the fetch and
this check standing alone.

`ownerSafetyNetApplies` is the single answer now and both paths ask it. It
takes the caller's scope rather than a boolean each site derives, so what
counts as a scoped key is decided once.
