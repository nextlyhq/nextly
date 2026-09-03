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

A placement's `column` is refused when it is present and malformed, and a
dashboard narrowed to fewer columns stores the arrangement the reader is
looking at.

`column` was the one placement field with no shape rule, so `column: "2"`
passed validation, failed the predicate that asks whether a placement stated a
column, became a 0, and was then read as an OMISSION -- which the layout
endpoint answers by keeping the column the card already had. A broken client
was told nothing and had its card silently kept or moved. Present and
malformed is now refused; omitted stays valid, because a client written
before columns sends none and that payload is supported.

Changing the column count moves no card and changes every answer about where
the cards are: narrowing four columns to two folds two of them into the last,
so the cards sharing a column are not the ones they were. The save renumbered
the array it was handed, which stored a reading of a grid that was no longer
on screen -- the canonical sequence disagreed with the arrangement until the
next drag. It is now numbered from the buckets at the count in force.

A collection also offers a TABLE card beside its count and its list: the same
recent entries drawn across named columns, which is the first consumer of the
`table` archetype the admin has always been able to draw and nothing has ever
generated.

Its columns are asked of the SOURCE rather than assumed. `status` exists only
for a collection declaring it and the timestamps only for one that has not
turned them off, so the card selects the ones that are there -- three columns
for a collection with a status and two without, rather than a fixed shape
padded with blanks or a select the read path refuses. A collection whose rows
nothing names, or that has no `updatedAt` to mean "recent", gets no table at
all, which are the two refusals the list card already makes.

The dashboard also offers a QUICK CREATE card: one click from the dashboard to
an empty entry form, for the collections this reader may create in.

Its shortcuts depend on the reader, which a declaration cannot express -- the
collection set changes while the process runs, and which of them a caller may
create in is a second question on top of that. So it is drawn from the
collection list the server already filtered, narrowed again by the create
grant. Neither half is a security boundary and the card does not pretend to be
one: the create endpoint enforces regardless, so a shortcut shown in error
costs a click rather than an entry nobody was allowed to make.
