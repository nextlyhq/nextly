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

A spacing drag handle sat on the wrong edge for most margins, and dragged
backwards there.

Which edge of a band moves when its value grows is a property of the layout
rather than of the box. Measured in Chromium, growing `margin-top` drives the
block's border edge down while its outer edge stays pinned by whatever precedes
it; `margin-left` does the same against the container, and so does `margin-right`
on a block whose width is auto — while `margin-bottom`, and `margin-right` on a
fixed width, do the opposite. The editor now asks the element on every side, for
margins as it already did for paddings, so the handle sits on the edge that
responds and the drag follows the pointer.

It asks each time it draws, so the handle follows whatever the block is doing
now: an edit that settles a height, a breakpoint that swaps the width model, a
container query answering to a sibling, a state being previewed, or the pointer
arriving and matching a hover rule. None of those has to be anticipated for the
handle to be right.

The measurement also leaves the page alone properly now. It works by pushing a
value onto the block and putting it back, and on a block with no inline style of
its own the attribute was left behind empty — invisible on screen, and visible to
everything in the editor that watches the page for edits. Nothing is left behind.

Two smaller corrections come with it. A handle on a negative margin now grows
the value in the direction the edge actually travels, instead of committing a
larger negative number and running the block away from the pointer. And a
transformed block is measured against the scale its margins are laid out in
rather than the one it renders at, which had inverted the handle on any block
carrying a transform of its own.
