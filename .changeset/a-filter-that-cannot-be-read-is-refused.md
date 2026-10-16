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

A filter that is not well formed is now refused instead of being run without
its bad part. Before, each form below was dropped on the way to the database,
so the read matched more entries than the filter stated, and a filter that
narrowed by owner or team could quietly return every entry. Through REST each
answers `400` with a `VALIDATION_ERROR` naming the problem at `where.<path>`;
through the Direct API, `find`, `count`, grouping, timelines and the
bulk-by-query writes throw the same typed `NextlyError`.

Newly refused, and what to write instead:

- **An unknown operator** (`{ title: { equal: "a" } }`, or `startsWith`) —
  `FILTER_UNKNOWN_OPERATOR`. Use one of `equals`, `not_equals`,
  `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`,
  `like`, `contains`, `search`, `in`, `not_in`, `exists`, `near`, `within`.
- **An unknown field**, or one with no column on the collection's table, such
  as a many-to-many relationship (`FILTER_UNKNOWN_FIELD`). Check the field's
  name; for a many-to-many relationship, read the related ids first and filter
  on `id`.
- **A dot path that is not into a component** (`{ "author.name": … }`,
  `{ "meta.key": … }`) — `FILTER_UNFILTERABLE_PATH`. It used to compare the
  whole `author` or `meta` column with the value. Look the related entry's id
  up first and filter on the relationship field: `{ author: { equals: id } }`.
- **`undefined`**, as a field's value or an operator's —
  `FILTER_UNDEFINED_VALUE`. Leave the condition out.
- **An empty `in`** (`{ id: { in: [] } }`) — `FILTER_EMPTY_IN`. It matches no
  entry, so skip the query, or leave the condition out if you meant "any".
  An empty `not_in` still excludes nothing.
- **An `and` or `or` that is not a list of filters**, or a list with a gap or
  a non-object in it — `FILTER_INVALID_LOGICAL` / `FILTER_NOT_AN_OBJECT`.
  Write `and: [{ … }, { … }]`.
- **An operand of the wrong type** — `FILTER_INVALID_OPERAND`: an object or
  list given to `equals` (use `in` for several values), a value that is not a
  list given to `in` or `not_in` (write `["value"]`), `null` given to any
  operator or as a field's value (write `{ exists: false }`, or
  `{ exists: true }` for `not_equals: null`), a list given as a field's value
  (write `{ in: [...] }`), `exists` with anything but `true` or `false`, and a
  `near` or `within` that does not parse. A geo operand now parses only in its
  documented form: an unknown unit (it used to mean metres), parts beyond the
  last one the format names (they used to be ignored), or a number with
  trailing text (`5abc` used to read as 5) is refused.
- **An empty condition** (`{ title: {} }`) — `FILTER_NO_OPERATOR`. Name an
  operator or leave the field out.
- **A malformed language filter** (`_translated` without a `locale` string
  and a known `state`, or anywhere but the top level) —
  `FILTER_INVALID_OPERAND` / `FILTER_MISPLACED_KEY`.
- **A component field or a geo operator inside `or`** — `FILTER_NOT_IN_OR`.
  Both are applied as a condition every entry must meet, so inside `or` they
  turned the alternative into a requirement. Move them to the top level or
  into `and`.
- **A REST `where` that is not valid JSON, or not an object** —
  `FILTER_INVALID_JSON` / `FILTER_NOT_AN_OBJECT`. It used to read as no
  filter at all.
- **A REST request carrying both `where=` JSON and `where[…]` parameters** —
  `FILTER_GIVEN_TWICE`. The bracket conditions used to be ignored. Send one
  form.
- **A REST bracket key that is not bracketed segments**
  (`where[title]equals=a`), that names `__proto__`, whose list index is 50 or
  more (the most conditions a filter may have), that nests under a value
  another parameter gave, that mixes list indexes and named keys at one level,
  whose index has leading zeros, or that repeats a condition already given —
  `FILTER_INVALID_KEY`. A `__proto__` field key in a JSON `where` is refused
  as an unknown field. Fields named `constructor` or `prototype` filter as any
  other field does.
- **A REST filter on the owner column** (`created_by`, `createdBy`, any
  spelling that resolves to it such as `CreatedBy`, or a dotted form) — `FIELD_NOT_FILTERABLE`. It used to be removed silently, so
  `or: [{ createdBy: … }]` matched every entry. The column is never returned,
  so it cannot choose rows either.

Two meanings are corrected rather than refused: an empty `or` now matches no
entry (it matched every entry), and an `or` holding an empty member such as
`{}` now matches every entry, as a condition that is always true does.

The REST bracket form also works again. `where[title][equals]=alpha` was read
into a field named `title]equals`, which matched no column and was dropped, so
every bracket filter returned all entries. A comma now splits values only for
`in` and `not_in`, where a single value becomes a one-item list:
`equals=Hello, world` compares with that text, and a `near` point reaches the
geo filter intact.
