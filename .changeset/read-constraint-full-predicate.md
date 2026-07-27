---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Read rules that narrow by a filter are now applied in full. A stored read rule can return a filter describing which rows the caller may see, and only part of it was being applied: the first field's `equals` value. A rule naming two fields filtered by one of them, a rule using any other operator applied nothing at all, and a rule whose value was legitimately falsy — `0`, `false`, an empty string — also applied nothing. In each of those cases the read returned rows the rule was written to exclude, and the matching count reported them too.

Filters now go through the same translation your own `where` clauses use, so every field and every supported operator binds. Owner-only rules are unaffected: a single non-empty owner id was the one shape the old path handled correctly, which is why this went unnoticed.

A filter is applied only if **all** of it can be applied, and access filters are held to a narrower shape than the `where` clauses you write yourself. A filter may name columns on the collection (or its localized fields) and compare them with any supported operator, including the shorthand `{ field: value }` form. Logical `and`/`or` groups, dotted paths like `author.name`, and empty `in`/`not_in` lists are refused rather than approximated, because each of those translates to something narrower than the rule states — or, in the dotted case, to a comparison against a different column.

A refused filter is reported as forbidden, and the matching count refuses identically. If you need a shape that is currently refused, the read fails closed instead of quietly returning more than the rule allows.
