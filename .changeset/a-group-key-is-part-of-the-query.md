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
---

A widget query can now carry a group key, and the validator judges it together
with the operation rather than separately. `groupBy` means something only to
the `groupBy` operation, so a key travelling beside `count` is refused instead
of being accepted and then dropped — an accepted-and-ignored key reads back to
the caller as a grouped count that was never computed. A `groupBy` operation
arriving with no key is refused for the matching reason, at the point that can
still say which part is missing.

The key is read once, with every other property of the query, so an accessor
cannot answer one field to the check and another to the query that ships. It is
checked against the fields its source declares, the same set `sort` and
`select` are checked against.

Sources that answer one fixed question say so: `keyof WidgetQuery` drives an
exhaustive table in each, so a query naming a key they cannot honour is refused
by name rather than silently discarded.
