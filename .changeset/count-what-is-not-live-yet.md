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

The dashboard can say how much work is waiting: `system:versions` answers how
many documents hold edits that are not live, and which ones were touched most
recently.

That needed a capability the data layer did not have. There was no `count`
anywhere in it -- collection totals go through an access-controlled path built
for collection tables, and nothing could count a system table, so a caller
wanting a number selected the rows and measured the array. The adapter now has
one, with `distinctOn` for the case that makes it worth having: a working draft
is one row per document per LOCALE, so "14 documents have unpublished changes"
counted from rows says 42 for an install translating into three languages.

`distinctOn` compiles to `COUNT(*)` over a `SELECT DISTINCT` subquery and never
to `COUNT(DISTINCT a, b)`. The inline form is not portable and fails in the
direction hardest to notice -- MySQL accepts it, PostgreSQL needs a row
constructor, and SQLite rejects it outright -- so a query written against one
engine is a syntax error on another. It is exercised against all three.

The access decision lives in the resolver, which is the difference from
`system:releases`. That service authorizes itself, so its resolver hands the
caller through and adds nothing; `VersionsService` has no authorization at all,
and none of its methods takes an actor. A resolver that simply called it would
answer an install-wide number to a reader entitled to part of it, so the reads
are bounded by asking the access layer per registered entity -- the same
decision the dashboard's own endpoints take. That is not the same as filtering
the caller's permission slugs, in either direction: an API key is judged on its
OWN stamped scope rather than on the roles of whoever minted it, and a
collection authorized or refused purely in code is decided by its rule rather
than by a permission row. The answer is always enumerated, so a caller who may
read nothing gets exactly nothing rather than a value that could be read as no
filter at all.

The card publishes the document's identity and its instant, never the snapshot:
that column is the unpublished content itself.
