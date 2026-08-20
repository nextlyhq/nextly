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

The translator that turns a `WhereClause` into a Drizzle condition existed
twice: the copy the adapter calls on every filtered read, update and delete,
and a second, identical copy in `nextly` that nothing imported. The drizzle v1
migration had already had to apply the same fix to both. The unused copy is
gone, and the shipped one now carries the test suite — rewritten to assert the
SQL and parameters each operator produces, so a filter that quietly means the
opposite of what it says cannot pass.

Writing those tests turned up two ways a filter could silently widen, and both
are fixed. Neither affects a where clause that already produced a condition.

- A clause whose branches ALL resolve to nothing — `{ and: [{}] }`,
  `{ not: {} }`, `{ or: [{}] }` — used to come back as "no condition". Because
  `update` and `delete` take the where clause as a required argument and omit
  the WHERE when none is returned, asking to delete a subset that way deleted
  the whole table. It now throws. An empty `{}`, which is how callers say "no
  filter", is unchanged.
- `CONTAINS` now matches its value literally: `%` and `_` inside it are escaped
  rather than acting as wildcards, so `CONTAINS "50%"` finds the text "50%"
  instead of every row containing "50". Verified against PostgreSQL 17,
  MySQL 8.4 and SQLite.

`WHERE_OPERATORS` is a new export from `@nextlyhq/adapter-drizzle/types`: the
list of every operator a where clause accepts, as a value. The `WhereOperator`
type is now derived from it, so code validating caller input against the list
and the type narrowing that input cannot fall out of step.
