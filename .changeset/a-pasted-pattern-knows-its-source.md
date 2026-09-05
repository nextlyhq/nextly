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

The digest describes what a copy would CARRY, so a root's own provenance is
excluded from it. Inserting overwrites that field, and hashing it would make
clearing an inert record nothing copies report every existing copy as stale. A
record deeper than a root is hashed, because that one is copied as it stands.
The exclusion lives inside the digest rather than at the call site, so a later
staleness check cannot hash different content from the copy it is judging.

A pattern handed over without an identity is refused rather than given a record
the op layer rejects. Every non-empty string is a legal id and only the empty
one is not, which a type cannot say.

Node ids are excluded from the digest too, for the same reason a root's own
provenance is: inserting mints every id fresh at every depth, so no stored id
reaches a copy. Hashing them made an identity-only rewrite of a pattern report
every existing copy as stale at once.

The rule inside the digest is now one question asked of each field — does a copy
carry this, or does inserting regenerate it? A field the copy derives FROM stays
in: renaming a `cssId` from `pricing` to `plans` changes what every copy renders,
because the minted replacement is built from the stored value. The walk is
structure-aware rather than a serializer replacer keyed on the name `id`, which
would have dropped a prop an author named `id` and an `attributes.id` the copy
does carry.

An id reference is hashed as its tokens, because that is how the copier writes
it back: `"hero   label"` and `"hero label"` name the same two references and
every copy carries the second, so hashing the spacing reported a change no copy
can show. Through the copier's own rule, now published, rather than a second
split that would agree until one of them moved — and only for the
reference-valued attributes, since whitespace inside an ordinary one is content
a copy carries exactly.

An attribute stored under `__proto__` is hashed like any other. Attribute names
come from persisted JSON, and assigning to that one runs the legacy prototype
setter instead of creating an own property — so the attribute would have been
absent from what is hashed while the copier carries it, and editing it would
have produced the same digest and no upstream-change notice. Written through the
package's prototype-safe record writer, which exists for exactly this.

The rules these copiers share are reachable from the package entry. A module's
`export` keyword makes a symbol importable within the package; a consumer gets
only what the entry re-exports, and two of these had the first without the
second — so a surface holding `BlockOrigin` had no way to check one, and a
surface copying nodes had no way to tokenise an id reference the way the copier
does. Both are the defect the rules were centralised to prevent: a caller who
cannot import the answer writes a second one.

A test now asserts that every function `document.ts` and `tree.ts` export is
reachable from the entry, asked of the module object rather than of the index
source, so a re-export that does not resolve cannot pass it.
