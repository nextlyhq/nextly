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
---

Whether a caller may filter, sort, group or search on a field now follows
whether the field's `read` rule lets that caller read it. Before, any field
with a `read` rule was refused for every caller, the ones the rule allows
included.

The rule is asked for the caller with no entry, since a query has none yet:

- **A rule that allows the caller outright** (by role, permission or
  identity, such as `({ req }) => req.user?.role === "admin"`) now lets that
  caller filter, sort and group on the field, and a collection's search
  matches on it for them.
- **A rule that refuses the caller** is refused as before, with a `400`
  naming the field as written: `FIELD_NOT_FILTERABLE`, `FIELD_NOT_SORTABLE`
  or `FIELD_NOT_GROUPABLE`. A collection's search leaves the field out.
- **A rule that needs the entry to decide**, such as
  `({ req, data }) => data?.owner === req.user?.id`, cannot allow without one,
  so the field cannot be queried by anyone, its owner included, and search
  leaves it out. A filter or an ordering on it would reveal its value on the
  entries where it is hidden. To query by ownership, filter on the owner field
  itself.

A widget data source still offers a group key only when no `read` rule
guards the field, since one source serves every caller.
