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

A job now runs with exactly the authority of the person who queued it, and a
release scheduled far ahead no longer quietly prunes itself.

The identity a job resolves is built by the same constructor every authenticated
request uses. It previously assembled its own, which dropped the single-role
alias that rules written as `user.role` read: those rules compared against
nothing, denying authorized work — and a negative rule such as
`user.role !== "suspended"` GRANTED work it should have refused.

A job also re-proves it still holds its lease after resolving that identity.
Resolving it is two database reads, and a lease that expired while they were in
flight could be taken over by another runner, which then did the work a second
time.

`retentionMs: null` now does what it documents. It means "keep the history, I
prune it myself", and it was being read as "unset" — so the seven-day default
came back and deleted the rows a deployment had asked to keep.

The content client handed to a job handler carries the Direct API's own
signatures, so `ctx.content.find({ collection: "posts" })` compiles and its
result is usable without casts. Passing `overrideAccess` or `user` through it is
now a compile error rather than something silently ignored.

On MySQL, the column recording who a job runs as is as wide as the user id
column it stores, so a job queued by a user with a longer id is no longer
refused — or truncated into an id that resolves to nobody, which was reported as
a deleted account.

Two lint gates were repaired. The v1 upgrade simulation now recognises the jobs
table as a legitimate post-0.45 addition instead of a phantom diff, and source
modules under `src/` whose names begin with `run-` are linted again: a pattern
meant for dev-tooling scripts had been silently excluding three real modules
from every lint gate.
