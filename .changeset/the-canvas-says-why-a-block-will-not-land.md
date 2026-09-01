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

The page builder says why a block will not go where you aimed it.

Dragging a block on the canvas used to answer one question — a line showing where
it would land between its siblings. Everything else was silent. A block gave no
sign it could be picked up, nothing showed which block was moving once it was,
and a region that would not accept it simply showed no line at all, which reads
as the editor not noticing rather than as an answer.

Dragging now says all of it. A block shows a grab cursor before the press and a
grabbing one during; the block being moved dims where it sits, so it stays
readable instead of being replaced by a floating copy; the container that will
receive the block is outlined, which the line alone cannot say when the same
coordinate is the bottom edge of one container and the top edge of the next.

And a refusal explains itself. Dropping a block into a container that will not
take it shows a "no drop" cursor, outlines that container, and names both the
reason and what the container does accept — so "no" arrives as an instruction
rather than as nothing happening. The three reasons a drop can be refused each
get their own wording, because they need different things from an author: aim at
a different container, put the block inside one, or use a different slot.
