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
"create-nextly-app": patch
"nextly": patch
---

Keep a slot whose stored name is `__proto__`, and stop refusing to edit a document that cannot be serialized.

Rebuilding a record under keys that came from stored data lost any entry named `__proto__`: plain assignment invokes the legacy prototype setter rather than creating a property, so the slot vanished from `Object.keys` and from the stored JSON, and the record's prototype was silently replaced. `removeNode` and `migrateDocument` both hit this, which means deleting one node — or migrating an unrelated one — could delete stored content elsewhere in the same document. `insertNode` had it in both directions, since reading `slots["__proto__"]` returns `Object.prototype` rather than `undefined`.

Separately, the tree primitives now agree on what to do with a document that `JSON.stringify` refuses. They transform what they can reach and never refuse work because the document they were given was already damaged; whether the result can be saved is decided once, at the write, by the check that already answers it. Previously `duplicateNode` alone refused outright when any part of the forest was cyclic, so a corrupt block anywhere on a page stopped an author copying a healthy one.
