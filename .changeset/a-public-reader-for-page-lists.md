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

`nextly/runtime` exports `createPublicReader` (`@experimental`): the read a published
page's lists should go through. It takes a list's query as data (typed filter rows, sort
keys, `limit`, `offset`, `page`, `select`) and fixes the access options:
published entries only, the anonymous visitor's read rules, no field the public may not
read, and unknown sort keys refused. Any option that would widen the read is refused by
name, and the read runs detached from any request in flight. `find` answers the canonical
`{ items, meta }`; `count` answers a number.

A collection read also takes `unknownSort: "refuse"` (`@experimental`), which refuses a
sort key that names no sortable field, naming each one, instead of dropping it with a
warning.
