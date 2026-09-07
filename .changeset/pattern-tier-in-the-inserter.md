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
A pattern is offered only if the planner could actually place it: not one with no roots, not a document that is not a pattern, not a row whose document was never filled in, and not one whose own nesting no longer holds. The last is what a stored pattern is exposed to — it is saved once and inserted for as long as it exists, so a block that later declares a parent restriction invalidates edges inside documents nobody has touched.

The rules those verdicts ask are now published from the engine as `placementVerdict` and `internalNestingVerdict`, and the planner's own refusals derive from them: a palette, a canvas and a planner asking the same question three ways is how one comes to offer a placement another refuses. `isPatternDocument` is published for the same reason.
