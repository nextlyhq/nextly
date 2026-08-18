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

An email provider whose parser returns a value JSON can only carry as text now has it stored in that form, instead of the save being refused.

The stored configuration is defined as its serialisation, so a `Date` becoming an ISO string is a coercion and is accepted. A parser returning a value that would LOSE data is still refused, and the message now names the field that would be lost rather than describing the rule in the abstract: a key JSON drops, an array's named properties, or a `Map` or `Set` whose entries serialisation cannot see at all.

A parser that returns a different value each time it reads the same input is still refused, because stored credentials would not survive a read. That comparison is now structural, so a parser that rebuilds its output field by field is no longer refused for changing the order of its own fields.
