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

A plugin route received the caller's account and nothing else. For a request
authenticated with an API key that account is the key's OWNER, so the access
check resolved the owner's roles and a key scoped to read was authorized to
write whatever its owner could — reaching, for a key minted by a super-admin,
the unconditional super-admin allow.

`AuthenticatedScope` already existed for exactly this and is honoured by the
collection access services; the plugin route path was the one surface it was
never wired into. The key's own grants now travel with the account, from the
dispatcher through `ServiceOpts` and `RequestContext` to the collection facade.

A session caller is unaffected: it carries no key scope and resolves the same
way it always has, super-admin bypass included.
