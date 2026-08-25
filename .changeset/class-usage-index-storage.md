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

The page builder now stores a reverse index of which documents reference which named classes.

The classes UI has to answer "how many places is this used" before an author renames or
deletes a class, and a class is referenced BY ID from inside each page's stored document.
Answering that live means opening every page on the site every time the number is shown -
and a page's blocks live in one JSON-shaped column across three dialects with no shared,
portable containment query, so there is no cheap version of that scan.

`nx_pb_class_usage` records one row per reference: a document that uses three classes
contributes three rows. The question the library asks is "which documents use THIS class",
so a row per pair answers it with an indexed lookup instead of a walk over every document.

A single is addressed by its SLUG, with an empty entity key, because its row may not exist
until somebody edits it - an unedited single still renders its declared defaults. The key
is kept non-null so the five columns form a real uniqueness constraint: a nullable member
compares as unknown on most dialects, which would let duplicate rows through exactly where
the count needs them not to.

The table is written by the plugin and closed to everything else. `internal` sets
`admin.hidden` and nothing more - no API route, dispatcher or registry sync reads it - so
the access rules are the only thing keeping these rows private, not a second layer behind
a first.

This release adds the table and the logic that decides its contents. Nothing maintains it
yet; the write path follows.
