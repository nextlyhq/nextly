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

Sorting and searching can no longer read a field the caller cannot

The guard that stopped a `where` naming a read-protected field left three
neighbouring paths open, each reaching the same value by a different route.

Sorting by a protected field ordered rows by a column the caller could not see,
and order is a comparison: a caller able to create rows with chosen anchors can
bisect a neighbour's value from where it lands between them. Refused now.

Searching matched protected columns, because text fields are auto-detected as
searchable and the search predicate never consulted field access. Search is
NARROWED rather than refused: the caller named no column, so dropping the ones
they may not read answers exactly what they asked.

A group or repeater carrying no rule of its own but holding a protected child
was filterable as a whole. These are stored as JSON, and as TEXT on SQLite, so
`contains` against the serialised container probed the child without naming it.
The guard now judges a container by anything nested inside it.

One correction in the other direction: the filter guard judged the predicate
AFTER hooks had settled it, so a `beforeRead` hook narrowing a read by a
protected column -- a tenant scope is the ordinary case -- had the whole read
rejected. It now judges what the CALLER sent. Trusted server code narrowing a
read is what those hooks are for.

Framework lookups say so explicitly. Content routing addresses a page by its
slug, and a site may protect that field; without a way to declare the filter as
the framework's own, an enforced route would 404 every page. The declaration is
per-operation and cannot be inherited, since a config-level exemption would let
a caller's filter acquire it through a nested read.
