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
until somebody edits it - an unedited single still renders its declared defaults. The key is
kept non-null rather than nullable, because a nullable member of a uniqueness constraint
compares as unknown on most dialects.

No composite constraint is created over those columns, and that is a limitation rather than
a choice: a collection's declared `indexes` do not reach the schema pipeline, which derives
a table's indexes from its FIELDS. Uniqueness is kept by reconciliation instead - a second
row for a class already recorded is removed rather than counted - so a race between two
writes to one document can both insert. The `classId` lookup is a field-level index, which
the pipeline does build.

The table is written by the plugin and closed to everything else. `internal` sets
`admin.hidden` and nothing more - no API route, dispatcher or registry sync reads it - so
the access rules are the only thing keeping these rows private, not a second layer behind
a first.

A document whose references cannot all be read contributes ONE row with an empty class id
rather than a row per class it managed to read. Skipping the write preserves whatever rows a
subject already had and preserves nothing when it has none - which is the state an oversized
document is in the first time anything indexes it - so without the marker that subject looks
exactly like one referencing nothing, and a class its unread part applies reads as unused. A
lookup for a real class never matches a marker, since a class id is never empty.

The table records no webhook events. An omitted `webhooks` option RECORDS - the registry
reads `webhooks?.record !== false`, which `undefined` satisfies - so a site with an endpoint
subscribed to `entry.*` would otherwise receive every row this table writes, carrying the
full document, and access rules are not consulted for outbox delivery.

This release adds the table and the logic that decides its contents. Nothing maintains it
yet; the write path follows, and it owes reconciliation one guarantee this cannot give
itself: the diff must be serialised with the document write it derives from, or re-derived
from the row that won, because two writes diffing against the same stored rows can otherwise
let the loser's removals delete rows the winning document still justifies.
