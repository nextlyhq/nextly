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

An update that carries the `_rev` it read is now judged against it (experimental). When someone else's save changed the document in between, the update is refused with `STALE_VERSION` (HTTP 409) and nothing is written. The refusal gives the document's current version. A caller who may read the document is also told who or what changed it last and when, and, where the document keeps history, the newest recorded version to compare against. An update with no `_rev` is applied as before.

- A save of one language is judged on that language and on the shared fields. Another language's save never makes it out of date.
- In `updateMany` and the in-transaction updates, each entry is judged on its own: an out-of-date one is reported and writes nothing, and the others are applied.
- An update of several documents with one set of values (by ids or by query) that carries `_rev` is refused with 400.
- A `_rev` that isn't a version a read returned, or that comes from a read of another language, is refused with 400.
- An update of every language at once (`locale: "*"`) needs the version a read of every language returned: one that doesn't name each language is refused with 400.

If your code reads a document once and then saves it several times with `{ ...doc }`, take `_rev` from each save's result, or the second save is refused.

An update can now choose to overwrite. Send `_overwrite: true` with the values, beside the `_rev` you read, and the update is applied whatever the document's current version, on REST, the Direct API and the plugin service alike, single updates, batches and bulk updates by ids or by query included. It needs no permission beyond the update itself, and `_overwrite` is never stored. Any value other than `true` or `false` is refused as a validation error.

Every overwrite is recorded in the document's history, whether or not it keeps versions. When the version sent was out of date, the history names whose changes it replaced ("Overwrote changes by Ben"); with no version, or the current one, it says only that the save was an overwrite. A save whose overwrite cannot be recorded is not kept. `_overwrite` is experimental.
