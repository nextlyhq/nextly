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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The email delivery log is now bounded, and an erasure request survives a
secret rotation.

The log records who was written to, identified by a digest of their address,
and it grew on every send with nothing to remove it. The column that was meant
to govern it and the index beside it were written and never read, so an
operator reading a labelled retention class would reasonably have concluded
something enforced it.

A sweep now removes rows past their window. It is offered by the SEND path
rather than by a content write, because rows here are created by sends: that is
when the table grows, a content write has no relationship to email volume, and
an install that never sends mail carries no pass at all. Omitting the setting
keeps a default window rather than keeping rows forever, since an unbounded
record of recipients is not a reasonable default for a table an install fills
without opting in.

This is the second half of erasure, and the halves cover different people.
Erasing a named recipient only reaches someone a caller can name, and many
recipients never had an account. The sweep reaches every row by age, whoever it
belonged to.

Erasure also reached only rows hashed with the CURRENT secret. Rotating it left
older rows carrying a value the request no longer computed, so it matched
nothing and reported success — a privacy request that silently under-delivers.
Retired secrets can now be listed in \`NEXTLY_SECRET_PREVIOUS\`, kept for reading
and never for writing, and an erasure matches every digest those generations
could have produced.

Two things are deliberately unchanged. A send already in flight when a deletion
commits still records its row; closing that would mean keeping a list of the
addresses that asked to be forgotten, and the sweep bounds the row instead. And
the retry columns stay inert: nothing drains this table, and a queue nobody
drains looks durable without being so.
