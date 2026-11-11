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

Every running server copy now serves a schema change within a few seconds, with no restart. Each copy reads the database's stored schema version at most once every 2 seconds (one indexed read, shared by every request arriving meanwhile, and none while no requests arrive) and, when it moved, loads its collection, Single and field group definitions again from the registry, so a field added in the Schema Builder on one copy is written and read on every other. The first read after a start loads them once more, since the start's own load cannot be dated against the version.

The `X-Nextly-Schema-Version` header now carries that stored version, one number for every copy, rather than a count kept by each process. `bumpSchemaVersion` (from `nextly/runtime`) keeps its signature and now asks the next request to read the stored version at once; it returns the version served until then. A registry write in this process does the same by itself.

The admin's metadata reads (the collection, Single and field group lists, and collection and Single schemas) answer with an `ETag` that is a hash of the body sent, and answer `304 Not Modified` with no body to a request whose `If-None-Match` holds it: only when an ordinary request would receive the same bytes. `If-None-Match: *` is not honoured, and the startup request answers every part in full. Every admin API response to a signed-in request (one with a session cookie or an `Authorization` header) is now marked `private, no-store` and varies on the credentials, whatever its route asked for, so no shared cache keeps it.
