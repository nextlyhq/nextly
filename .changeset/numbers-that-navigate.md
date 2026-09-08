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

The dashboard can draw a card of several numbers, each one a link into the list
it counts. `stats` is a new archetype: where `metric` is one number from one
query, a `stats` card declares `cells`, and every cell carries its own query.

Each cell being its own ordinary `count` is what keeps the card honest about
access. A reader who may not read one of the collections simply loses that
number, judged by the same rule every other widget query is judged by -- where
one composite query would need a source that knows every domain it counts, and
a single authorization decision covering all of them.

Every collection that declares a status now generates a health card: total,
published and draft, with each number linking to that collection's list filtered
the same way. The link and the number are built from one value, so a card cannot
promise a filter its link does not apply.

`stats` is classified as its own kind rather than filed under an existing one.
`DATA_ARCHETYPES` means "requires the singular query field", which a stats card
must not have; `QUERYLESS_ARCHETYPES` means "needs no data at all", which the
admin turns into a body that never enters the batch. Both names have agreed
until now because no archetype needed data without using `query`.
