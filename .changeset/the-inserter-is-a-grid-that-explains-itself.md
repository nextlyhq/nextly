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
"@nextlyhq/ui": patch
"@nextlyhq/tsconfig": patch
---

The Insert panel is a grid of tiles, and the block you are pointing at explains
itself in a strip along the bottom.

It was a list: one block per row, each carrying two lines of description. Every
block was legible and only a handful were visible at once, so finding one meant
reading rather than recognising, and the panel ran to well over a screen for a
library of twenty blocks.

Making it a grid on its own would have meant deleting the descriptions. A tile
at the panel's default width is about eighty-six pixels — an icon and a short
word — while the descriptions run from ninety-nine to a hundred and eighty-five
characters, and they are not padding. Card's description is what says it CLIPS
its contents, which is the whole reason to choose it over Box. Accordion's is
what says it restricts what can be dropped inside it. A grid that dropped them
would look better and answer fewer questions.

So the descriptions moved rather than went. The tile under the pointer, or
under the keyboard, is described in full in a strip at the foot of the panel.
It follows FOCUS as well as hover, which is what separates it from a tooltip: a
tooltip is reachable only with a mouse, so it is no help on a touch screen and
no help at all to anyone arrowing through the panel.

Arrow keys now follow the grid rather than the old list. Down moves a row, not
one tile to the right, and it crosses into the next category at the column it
left — landing on the tile that is visually below, including where a category
ends on a short row. Left and Right move one tile, but only once the search
field has no caret left to move, so correcting a typo in the search box still
edits the text instead of jumping the selection.

Each tile is now NAMED by its block and DESCRIBED by its sentence, rather than
announcing the two run together. A screen reader previously read a tile as
"TextA paragraph of plain text" — the name and the description concatenated
with no separator, and whether any separator appeared at all depended on the
stylesheet rather than the markup. The two are now stated separately, so the
block's name is read first and its description second.
