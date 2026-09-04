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

Publishing a page says whether its components are live.

A page and the components it embeds are separate documents with separate
lifecycles, so publishing the page said nothing about them. The page then drew a
missing-component marker exactly where the author expected content, and the save
reported plain success.

It now reports. Publishing still succeeds — publishing a page before its
components is an ordinary order of work, and refusing it would block a
legitimate sequence to prevent a state the author is about to leave anyway — and
the response carries a notice saying how many embedded components are not live.

Which states count as published is not decided a second time. The check reads
the component store under a published scope and treats the ids that do not come
back as the answer, so the query service keeps owning a rule a project can
extend with public states of its own. That also collapses two cases worth
collapsing: an unpublished component and a deleted one leave the same hole, and
the author's next move is the same for both.

It asks the renderer's own discovery rather than walking stored documents. That
is not an optimisation, it is the difference between two questions: reachability
is decided after an instance's overrides have chosen a component, under the
composition cap, over the tree the repair pass retained. A walk answers before
all three, so it names components a visitor never meets — a condition-gated
instance, slot content the chosen definition discards, an id an override
replaced — and misses ones it does. `unsuppliedComponentIds` is exported from
`@nextlyhq/blocks-react` so a caller outside the render can ask the question
without building a second traversal, which is what this now uses.

That also settles nesting for free: a published component embedding an
unpublished one is a hole the renderer meets one level down, and the discovery
already runs to a fixed point.

It reads one component field, the one the renderer reads, rather than every
blocks field a store happens to carry.

It stays silent where it cannot decide. A localized component store publishes
per language on a companion row, so a published-scoped read answers for no
language in particular and would report live components as missing; a notice
that fires on a case it cannot decide is one authors learn to dismiss. It also
declines inside a caller-owned transaction, where it would read a database that
does not yet contain the write it was called for.

The condition is the state the write LEAVES BEHIND rather than the transition
into it, so dropping an unpublished component into an already-live page reports
too — the case a publish-time-only rule would miss. It requires the collection to
own the Draft/Published lifecycle, because `status` is an ordinary field name a
project may use for its own vocabulary and the name alone answers nothing. And it
says nothing on a working-draft save: a pending draft keeps the live parent's
`status`, so it is indistinguishable from a publish by its own fields while the
document a visitor loads has not changed at all.

To make that last one answerable, a write that stores a working draft now stamps
`_isWorkingDraft` on the document its post-commit hooks receive, not only on the
response. The read overlay already marked it; a hook could not ask.

The lookup is chunked. A collection query is clamped to 500 rows and returns a
subset silently, while a document may reference far more instances than that, so
one unbounded query would report every published component past the first page
as unpublished.

It reads what the adapter actually stored. JSON columns come back as text on
SQLite and any adapter that stores them that way, and the write path parses them
after these hooks run — so an object-only check found no documents at all there
and reported nothing for every page, silently.

It says nothing for a localized page collection, for the reason it says nothing
for a localized component store: publication happens per language on a companion
row whose status the write path deliberately does not merge into the document
its hooks receive, so the main row answers for no language in particular.

Bulk writes carry their warnings too. `respondBulk` already emitted them and the
admin dropped them at the response type, so an author publishing ten pages at
once was told nothing an author publishing one of them would have been told.
Both bulk hooks now report through the same presenter single-entry writes use.

A component the discovery cap stopped it from asking about is no longer named as
unpublished. The page does have a hole there, but nobody failed to publish
anything, and publishing the named component again cannot repair it.

A host that pointed the renderer at a different component store, or supplies
definitions from a custom source, can point the notice at the same store or turn
it off, and can name the single page field a route renders where a collection
declares several: the route is configured in the host's app and is not visible from the
write path, so a redirected renderer would otherwise be judged against a store it
does not read from.

Warnings now carry a severity. A post-commit hook could already tell a caller
that a side effect broke, by raising; there was no way to say something true
about a write that succeeded, and an advisory sent through the failure channel
arrives wearing a failure's code. Both travel in one array because they are one
question to a consumer, and the admin reports them differently: a save with only
an advisory is no longer phrased as though something failed, and a real failure
still owns the headline while the advisory travels beside it rather than being
dropped. Anything not explicitly marked an advisory is treated as a failure, so
a server that never sends the field cannot have its failures downgraded into
reassuring language.

The notice offers no action yet. Publishing the components alongside the page is
a separate capability, and copy promising an affordance nobody can reach is
worse than copy promising nothing.
