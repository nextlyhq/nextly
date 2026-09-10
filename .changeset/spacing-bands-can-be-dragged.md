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

The spacing bands on the canvas could only be read. Every change to a margin or
a padding had to be made in the Style panel, with the author's attention in one
place and the space they were judging in another.

Each band now carries a handle on the edge that moves. Dragging it previews the
value live and writes the document once, on release, so a gesture of fifty
pointer moves costs one entry in the history rather than fifty. Shift moves
every side of the box and Alt moves the pair across from it, each side stepping
from its own starting value so a deliberate asymmetry survives the gesture.

The handles are focusable and take the arrow keys, with Page Up and Page Down
for a coarser step, so everything a drag can do has a keyboard route to the same
value — the Style panel's fields remain the third. Which side a handle writes is
resolved from the element's own writing mode and direction, so dragging the left
edge of a right-to-left block edits the inline END, as the page renders it.

A side whose value is a token, `auto`, a percentage or any other unit a pixel
drag cannot preserve refuses to be dragged and says so, rather than silently
replacing it with the pixels it happens to resolve to today.
