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

The registry sync compared stored JSON through its own canonicaliser, and the
schema domain compared it through another. Two implementations that agree today
are one edit away from disagreeing, and the failure they produce is silent: a
resource that re-syncs on every boot, or one that never notices a real change.
There is now one, `shared/lib/canonical-json`, and the registry base class calls
it.

One behaviour changes with the move. A value containing a cycle used to throw
out of the comparison and take the sync down with it; it now serialises to
`undefined`, so two unrepresentable values compare equal and the sync proceeds.
A cycle cannot survive a round trip through the database in the first place, so
the throw could only ever report a bug in the caller — loudly, in the wrong
place, at boot.

No exported API changes: the comparison is a protected method on the registry
base class and both call forms are internal.
