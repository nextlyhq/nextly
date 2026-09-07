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

The inserter can offer a saved pattern, judged by where all of its roots may go.

Its catalog was blocks only by construction, and the type said so: patterns
"have no mechanism in this engine and are therefore ABSENT rather than stubbed".
The mechanism landed with the composition planners, so the absence became a gap.

`InsertEntry` is now a discriminated union of a block entry and a pattern entry,
and `patternEntriesFrom` builds the second from stored rows. A pattern is
multi-root and is inserted as one atomic group, so it may go only where EVERY
one of its roots may go — asked of the same nesting rule a block is asked of,
which is what keeps the palette from offering a placement the insert refuses.
`InsertPanel` takes the patterns to offer and places a chosen one through `planInsertPattern`, as one edit — so a whole pattern undoes in a single step rather than one root at a time. The rows to offer are supplied rather than fetched, as the block definitions are: where a pattern lives and how a host loads it is the host's question, and `SavedPattern` is published beside the panel so a caller can map its query onto it. The drag gesture stays blocks-only, because a drag carries one node to a drop target and a pattern is a forest.

A pattern is offered only if the planner could actually place it: the engine publishes the planner's own pattern-only preflight as `patternRefusal`, and the catalogue asks it whole rather than keeping a subset of it. The ways a stored row can be unusable are not a short list — the wrong kind, no nodes, an envelope the apply cannot read, a node whose shape it cannot apply, two nodes rendering one DOM id, an internal placement the rules no longer allow — and a pattern is saved once and inserted for as long as it exists, so the rules can move underneath it.

The rules those verdicts ask are now published from the engine as `placementVerdict` and `internalNestingVerdict`, and the planner's own refusals derive from them: a palette, a canvas and a planner asking the same question three ways is how one comes to offer a placement another refuses. `isPatternDocument` is published for the same reason.
