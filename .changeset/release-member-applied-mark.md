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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A release pass that the host ends part-way, at a serverless function's time limit for
example, now makes progress on the next pass. Each document's write records, in the same
transaction, that its release member was applied for the release as it stands, so the next
pass writes only the documents still to go and settles their releases, and hooks and outbox
events no longer run twice for the documents already written. Rescheduling, cancelling or
otherwise changing a release voids those records, so its documents are written again.

Whether a refused write counted is now decided by that record rather than by reading the
document back: a release whose author may no longer publish a document is no longer marked
published because the document already read as live, and a read hook that rewrites `status`
changes nothing. `nextly migrate` and boot add one nullable column, `applied_revision`, to
`nextly_release_members` on every dialect; no row is rewritten. It is internal: release
members returned by the Direct API and REST do not include it.

Compatibility: `applyDueReleases`, exported from the package root, is experimental, and its
dependency ports change. A custom `repository` passed to it must now provide
`isMemberApplied(memberId, revision)`, return `appliedRevision` on the rows from
`listMembersOf`, and replace `markReleasePublished(id, at)` with
`markReleasesPublished(entries, at)`, which settles a whole component of releases, each fenced on
its planned `{ revision, scheduledAt }`, or none of them; custom `mutations` no longer provide
`applied`, and their `publish` and `unpublish` receive a `receipt`. The built-in drain job (`createReleasesDrainJob`) needs no
change.
