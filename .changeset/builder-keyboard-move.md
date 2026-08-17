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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(builder): move a block with the keyboard, on two axes

Dragging was the only way to reorder a block, so the editor could not be used by
anyone who does not use a pointer.

`keyboardMovePosition` answers where the selected block goes for four intents,
split across two axes so that each has an inverse: `up` / `down` reorder among
siblings and never change the parent, `indent` / `outdent` change the parent and
never reorder anything that stays put. Every press is undone by the opposite
press, which is what lets someone driving the editor without sight of the result
recover from a mistaken key.

It reports what the move DOES as well as where it lands, so the wiring can
announce "moved down" and "moved into Group" differently without re-deriving the
difference by comparing parents. Moves that change parent also name the slot they
vacate, because a keyboard author moves one block at a time and emptying a
container is the common case rather than the rare one.

One asymmetry is deliberate and pinned by a test: `indent` appends, so outdenting
a block that was not its container's last child and indenting it back returns it
at the end. Recovering the original index would mean carrying state across
presses.

Not yet exported from any entry point: it has no consumer until the canvas wires
it up.
