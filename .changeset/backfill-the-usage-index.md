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

The usage index is backfilled, so "used on N pages" can be exact on a site that
existed before it.

The write hooks maintain the index going FORWARD. Nothing filled it for
documents already stored when the plugin was installed, or when a version added
an index, so every component on such a site had no rows at all — and no rows is
indistinguishable from a component nothing uses, which is the answer a delete
decision acts on. Until now `complete` was false unconditionally for that
reason.

A sweep does the filling, because nobody is in a position to enqueue it: the
work is owed from the moment the plugin meets existing content, and the events
that make it owed are not things any handler sees.

Each pass walks one (collection, field, locale, variant) — the smallest unit a
rebuild can finish, so the largest one certain to make progress — stops at the
runner's deadline, and defers the rest to a durable queue. A scope is recorded
only after its walk resolves AND brings every row it touched into agreement, so
a partial rebuild is retried rather than marked done and never revisited.

A document too large to read whole is the one exception, and it is recorded
rather than retried. Exceeding a bound is deterministic — the same document
exceeds it on every pass — so refusing would leave the scope outstanding for
ever and make every drain rescan the collection. Such a document leaves an
`unreadable` marker instead, written before the scope is recorded, and that
marker keeps health from calling any count exact until a later save or a change
of traversal limits makes the document readable again.

It pages by KEYSET rather than by offset. Deleting a document the walk has
already passed shifts everything behind it back, so an offset walk skips the row
that crosses the boundary — survivable for a repair, where the missed document
keeps the rows it had, and not for a first fill, where it has none and nothing
notices. Resuming after the last id seen removes the shift entirely.

Collections come from the live REGISTRY, not from configuration. The Schema
Builder creates collections at runtime, and those exist only there; enumerating
the configured set would walk a narrower population than the hooks maintain
while judging readiness against that same short list.

Completion is recomputed against the scopes that exist NOW and against the
bounds the index is derived under. Adding a collection, a locale or drafts
returns the count to a floor until the new work is done, and changing
`pageBuilder({ limits })` starts a new generation rather than inheriting
progress made under bounds the renderer no longer applies.
