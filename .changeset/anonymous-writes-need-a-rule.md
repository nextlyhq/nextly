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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

**Security: an anonymous create, update or delete now needs a rule that allows it.** A
checked write with no signed-in caller (the Direct API with `overrideAccess: false` and no
`user`, or a plugin service call made `{ as: "public" }`, as a `public: true` route makes
one) used to be allowed on a collection or Single whose `access` named no rule for that
write. It is now refused. Reads keep the public default, publishing still needs a signed-in
user, and the admin's REST API is unchanged.

If you take anonymous writes on purpose, say so in the collection's `access`, for example a
public form-like collection: `access: { create: () => true }`. The form builder's
submissions already declare `create: true` and keep working.

A plugin's `deleteEntryInTransaction` made `{ as: "system" }` is now trusted, as its other
`{ as: "system" }` writes are; it was judged as an anonymous caller.
