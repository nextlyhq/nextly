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

An author who rounded a block's corners saw the spacing overlay paint colour into the
transparent corners beside it, outside the shape the block actually renders as. The padding
bands were full-width strips cut from the padding box's RECTANGLE, while a rounded padding box
curves away from that rectangle — and a band is read as a measurement, so one covering ground
the block does not occupy states a measurement that is false. The bands are now cut to the
curve, and the value chip still overflows its band so a number in a four-pixel gap stays
readable.

The same curve is now respected on the way in. A block inside a rounded container that clips
its overflow can sit within all four of that container's straight edges and still have a corner
removed by the curve; the overlay accepted it and drew bands across the part that is not
rendered. It now tests the corner itself rather than declining every rounded container, so the
ordinary rounded card keeps its overlay.

Two further cases the curve reaches. A block rounded to match the container it fills is not cut
at all, while its bounding rectangle's corners sit outside every one of that container's arcs, so
the overlay used to vanish on the ordinary nested rounded card; the block's own curve is now part
of the comparison. And an overlay already on screen now notices a radius change on its own —
nothing else about a band moves when only the corner does, so it previously kept painting the
curve the block used to have until something else happened to move it.
