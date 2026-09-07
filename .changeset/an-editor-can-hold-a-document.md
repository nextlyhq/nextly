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

Add `nextly/document-lock`, a client entry carrying the document lease contract
and its wire types and nothing else, and the admin-side hook that holds a claim
against it.

The entry is separate from the root one because the admin maps `nextly` to this
package's source, so reaching two constants through the root pulls the DI
container and the auth middleware into the admin's typecheck, measured at 112
errors about code it never touches. The timings are re-exported rather than
restated: they are the agreement between a lease and whoever renews it, and a
second copy of either number drifts from the first the moment one is tuned.

`deriveLeaseTimings` moved out of `database/lease-clock` into
`database/lease-timings`, which imports nothing. The clock module asks the
database what time it is, so it loads the ORM at module top level, and anything
reading the timings through it put that ORM into the import graph of every
client that needed a number. A check now walks the source import graph of every
published subpath an admin `"use client"` module imports and fails on one that
can reach a database package.

No editor mounts the hook yet, so nothing about using the admin changes in this
release. What ships is the mechanism the editor work builds on: the claim is
held for one document at a time, every reply is fenced on the claim token that
produced it rather than on the effect that sent it, a claim acquired after the
editor has gone is released rather than left for the lease to reap, and a run of
failed confirmations is treated as a blip until the lease's own loss deadline
and as a loss after it.
