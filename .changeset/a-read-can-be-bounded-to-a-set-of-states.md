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

A lifecycle-bounded read is bounded to a SET of states, not to one.

Nothing an author sees changes yet. The vocabulary is still `draft` and
`published`, every read returns what it returned before, and the whole suite
passes unchanged — which is the point of doing it this way round.

What changes is what the read path can EXPRESS. A workflow may call several
states public, or several states not-public, and an equality can only ever name
one of them: the rest would vanish from reads with nothing erroring. Phase 1
refused that case rather than emit a query it could not make correct. The
predicate now builds a set membership when there is more than one state and
stays an equality when there is one, so the widening is invisible to every
workflow that exists today.

The resolved filter carries WHY its set was chosen rather than leaving each
consumer to work it out. Deciding whether a due release may widen a read means
knowing whether the read is public, and four call sites were re-deriving that
from the values — a second answer to a question the resolver had already
answered, which disagrees the moment a workflow's public and non-public sets
are not complements.

The per-locale filter is widened with it. A translation is dropped when its
own `_status` falls outside the read's scope, and that test lived in two
copies plus two SQL builders; a draft translation surviving it is unpublished
text resolved onto a public row, so the copies are now one function.

A workflow is validated where it is DECLARED. A state name longer than the
status column, two states of one name, a workflow with nothing public: each is
otherwise found at write time, on one dialect, in production — and SQLite is the
permissive one, so a suite run against it says nothing about the two dialects
that reject it.
