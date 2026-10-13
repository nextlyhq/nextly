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
---

A collection's `db` options are now checked where the collection is defined.
Before, an `idType` the write path did not recognise gave UUIDv4 ids in
silence, and an `allowIdOnCreate` that was not `true` discarded every id a
caller supplied, and any other name in `db` was not read at all. Now an
`idType` other than `uuid` or `uuidv7`, an `allowIdOnCreate` that is not a
boolean, a name that is not an option (a misspelling such as `idTyp`), and
`db` options that are not an object are refused, naming the option.

`serial`, which a config carried over from Payload may hold, is refused with
its own message: a collection's id is text, which every relation and API path
reads. A sequential number, such as an order number, goes on a table keyed by
`col.serial()`.
