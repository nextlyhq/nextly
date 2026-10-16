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

The release list now pages on the server, with a true total. `GET /api/releases`
and `nextly.releases.find()` take a `tab` (`upcoming`, `attention`, `drafts`,
`done`), a `search` over the title and description, and a `page`; a new
`nextly.releases.count()` counts a tab without reading it. A release counts as
overdue, and moves to `attention`, once it is still scheduled 10 minutes after
its time; `reason: "overdue"` or `"stopped"` reads one part of that tab.
Tabs, `reason`, search, paging and `count()` are experimental.

**Breaking:** `nextly.releases.find()` now returns `{ items, meta }`, like every
other Direct API list, instead of an array, and it is paged: without a `limit`
it returns the first 50 releases, where it used to return every match. Read
`result.items` where you read the array and `result.meta.total` for the number
of matching releases; to process every release, ask for each page in turn
(`page: 1, 2, …` up to `result.meta.totalPages`, at most 200 per page).
`limit` must now be at least 1: a `limit: 0` call used to answer an empty list,
and a caller that only wanted the number of releases asks `count()` instead.

Scheduled releases listed without an `order` now come soonest first rather than
furthest out first. A release's documents come back in the order they were
added, and asking for the documents or blocking reasons of a release that does
not exist answers not found instead of an empty list.

New releases and release documents get time-ordered (version 7) UUIDs instead
of random (version 4) ones, so ties in the list keep the order they were made
in. They are still standard UUID strings in the same columns; only code that
checks the version digit would notice. Existing ids are unchanged.
