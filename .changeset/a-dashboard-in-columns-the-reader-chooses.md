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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

A dashboard is arranged in COLUMNS the reader chooses, rather than in one
wrapped twelve-column grid.

Cards took uneven fractions of twelve, so a card's width depended on its
neighbours. dnd-kit's sorting strategies predict positions from measured
rectangles and need a predictable layout; with mixed spans they mispredict and
the cards visibly resize mid-drag -- the behaviour its own tracker records as
variable sized sortables being stretched when dragged. Each column is now an
independent vertical list of equal-width items, which is the case those
strategies are built for and one that supports items of varying HEIGHT, the
dimension a dashboard card genuinely varies in.

A reader picks 2, 3 or 4 columns while editing. Placements gain a `column`
beside their existing `order`, the stored layout gains a `columnCount`, and the
schema moves to v2 -- migrating a v1 row on READ rather than refusing it, since
the reader would otherwise meet their own saved dashboard as an internal error.

Crossing columns is reachable by CLICK as well as by dragging. WCAG 2.2 SC
2.5.7 requires a single-pointer route to anything a drag achieves and states
that a keyboard equivalent does not satisfy it on its own, so the sideways
controls are what make the new drag permissible rather than a convenience
beside it.

Two fixes fall out of the same work. A card that changed only its column
compared as unchanged, so Save stayed disabled and a sideways move could not be
persisted at all. And a card whose column falls outside the current count is
folded into the last column for drawing while KEEPING its stored column, so
narrowing the dashboard and widening it again returns every card to where the
reader put it.
