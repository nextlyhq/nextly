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

Populating a relationship now withholds a related row from a caller who could not read that row directly.

- A scoped API key needs `read-<collection>` in its own scope to see rows of a related collection, whatever that collection's read rule says. Before, a key granted only the parent collection was shown related rows whenever the related collection declared no read rule or its rule admitted.
- A signed-in user reading a related collection that declares no `access.read` rule now needs a read permission on it, the same one a direct read of that collection asks for. Before, any signed-in user who could read the parent was shown those rows. Collections that do declare `access.read` still let that rule decide, with no per-collection permission required.
- A populated user (a relationship to `users`) and an upload's media row now need `read-users` and `read-media` for signed-in users and API keys. Before, both were shown to every reader of the parent.

Visitors are unaffected, as are reads made with `overrideAccess` (the Direct API's default) and the collections a content route trusts. A withheld row comes back as a reference to a missing row would, and the rest of the response is served.

**Upgrading:** to keep showing these rows on purpose:

- for an API key, add `read-<collection>` (or `read-users`, `read-media`) to its own grants; a read rule alone cannot restore it;
- for a signed-in user, grant `read-<collection>` (or `read-users`, `read-media`) to their role, or declare an `access.read` rule on the collection that admits them.
