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

The activity feed obeys a collection's stored read rule, and no longer publishes
a count it cannot authorize.

Its scope was collection-level, and `entryTitle` is stored on the log row at
write time rather than hydrated through the read path — so nothing between the
table and the response consulted a document rule. Under a stored `owner-only`
or `custom` read rule the feed reported other authors' entry titles, entry ids,
and the names and email addresses attached to their edits. Measured: with the
ordinary read returning one document for the caller, the feed returned four
rows spanning both authors.

Each row's document is now authorized as the caller, by the same decision the
pending-edit cards use — one implementation, so the two surfaces cannot come to
different conclusions about who may see a document. A stored rule can be an
arbitrary function and its constraint is expressed over the collection's own
fields, which an audit row does not carry, so the constraint cannot be pushed
into this query the way it is pushed into a collection read; asking the read
path about a known set of ids is the one form that works for every rule.

Rows that name no document keep their existing treatment: a settings mutation
is filed under a namespace that is neither a collection nor a single, the
caller's scope already admitted it, and dropping those would remove credential
rotations from the feed entirely.

`total` is gone from the response. It counted the rows the collection scope
admitted, so it reported edits to documents the reader may not open — the same
disclosure the rows carried, in a number — and it cannot be narrowed without
authorizing every matching row, which is unbounded over a table that only
grows. `hasMore` carries the pagination instead, observed by authorizing one
row past the page. The hand-written `COUNT(*)` behind the old field is removed
with it.

The activity feed now records the LANGUAGE a write was made in and authorizes
each row in it. A stored `custom` read rule is a predicate over a collection's
own fields, and a localized field answers differently per translation, so a row
judged without a locale is judged against the default one — and an edit made in
a language the rule denies could still show its title. The locale is derived
from the event resource that already carries it, so a write cannot report one
language to a webhook subscriber and a different one to the trail. Rows written
before the column, and writes with no language of their own, leave it NULL and
are read as the default, which is what they already meant.

Deleting a document no longer erases it from the feed. A collection delete
removes the row before appending `entry.deleted`, so the document the event
names can never be found again — and authorizing by readability alone dropped
the deletion, and every earlier event for that document, for everyone including
a super admin. Such a row is now kept without its stored title or metadata: the
rule that decided who could read them died with the document, so a reader learns
that something was deleted, by whom and when, but not what it was called. A
document that still exists and was refused stays refused, and a probe that
cannot answer drops the row rather than publishing it.

The feed also refuses outright when the content registry cannot be enumerated.
A slug missing from the registry is read as an install-level event and kept
without asking the read path — correct when the map is whole, and the same rule
admits every document row unauthorized when it is not.

Refill rounds are anchored to the last row read rather than to a running offset,
and ordered by a unique key as well as the instant: `activity_log` grows while a
feed is being built, so under OFFSET a row inserted between rounds shifts every
later position, repeating one row and silently skipping another.
