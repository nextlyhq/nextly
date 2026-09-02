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

The dashboard arrangement agrees with the grid that draws it.

Six corrections to how a widget's declaration reaches the stored layout. Two
plugins contributing the same widget id now resolve to the same one on both
sides -- the first declared, which is what the grid has always rendered --
rather than the server placing one plugin's widget while the grid drew another's.
A contribution using the deprecated `size: "half"` alias is translated to a real
size when the server builds its default arrangement, instead of storing a
placement with no geometry under a card the grid was already drawing at half
width. That translation now has one implementation, in core, which both sides
ask.

Removing a card and adding it back restores the height its author declared, not
only its width. A widget whose component draws nothing collapses its grid cell
again rather than leaving a blank full-width slot. Cancelling after a save
failed takes the failure message with it, instead of leaving "your changes are
still here" on screen after discarding them.

And a default arrangement is now bounded by the same limit a save is: an install
declaring more widgets than a single write may carry was answered with a default
layout the server would refuse, so the reader's first gesture failed and the
dashboard could not be arranged at all.
