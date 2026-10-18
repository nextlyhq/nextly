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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A document's writes now record its history in the record of content events,
each in the write's own transaction and with who made it, for collections and
Singles alike: its creation, each save that recorded a version, a restore
(naming the version it came from), each publish and unpublish, a version
being named, its working draft being discarded, its deletion, and a
retention pass that removed older versions. A publish or unpublish is one
event per kind naming the languages it moved, and publishing every language
is one event. A person is recorded by the name the request carried, an API
key by its own name, and the system (a Single created on its first read, or
retention) by none. A save that changed nothing records no event. Events are
written whatever a collection's webhook settings.

`versions.setLabel` takes an optional fourth argument, who named the version,
which records the name in the document's history in the same transaction.
