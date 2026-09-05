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

An inserted pattern records which pattern it came from, and what that pattern
looked like at the time.

Each inserted root carries `origin: { from: "pattern", id, digest }`, so "the
pattern this section came from has changed — do you want the change?" becomes
answerable later. It could not be added retroactively: a page built before this
can never be told where its blocks came from.

The ROOTS only. The run is what was inserted; a descendant did not come from the
pattern separately, and marking every node would make an author detaching one
child look like a second insertion.

It is OVERWRITTEN, never filled in only where absent. A root can arrive already
carrying a record from an earlier copy, and leaving that in place would
attribute the insertion to a pattern it has nothing to do with — worse than no
record, because a staleness check would then compare against the wrong source
and answer confidently.

For the same reason, saving a selection STRIPS any provenance it was already
carrying, at every depth. A stored pattern's nodes came from the page, not from
wherever the page's nodes came from, so a pattern saved out of already-inserted
content would otherwise claim a source it never had.

The digest is of content rather than a version. The engine is handed a document
and never an entry row — it can hash what it was given and cannot see what the
store calls it — and content answers the question more precisely anyway, since a
re-save that changed nothing bumps a version and leaves a digest alone. It is a
change hint and not a security boundary: a collision costs one missed notice,
which is why it is a short hash rather than a cryptographic one.

Inserting takes the pattern's identity alongside its document, as one value.
Two arguments could be supplied out of step, and an id belonging to a different
pattern than the nodes writes provenance that reads as authoritative and is
wrong.

The engine's forest rewrite is published. Three of its behaviours are ones a
caller changing a single field across a stored tree gets wrong — a cycle entry
dropped rather than kept, a malformed entry passed through, a malformed slot
preserved — and each was learned here. A planner that wrote its own walk
inherited none of them; the two that had are now expressed through the shared
one.
