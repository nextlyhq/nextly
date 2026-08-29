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
at the panel's default width is about eighty-five pixels — an icon and a short
word — while the descriptions run from ninety-nine to a hundred and eighty-five
characters, and they are not padding. Card's description is what says it CLIPS
its contents, which is the whole reason to choose it over Box. Accordion's is
what says it restricts what can be dropped inside it. A grid that dropped them
would look better and answer fewer questions.

So the descriptions moved rather than went. The tile under the pointer, under
the keyboard, or under a finger is described in full in a strip at the foot of
the panel. It follows FOCUS as well as hover, which is what separates it from a
tooltip: a tooltip is reachable only with a mouse, so it is no help on a touch
screen and no help at all to anyone arrowing through the panel. It follows a
PRESS too, because a touch screen sends no hover before contact — without that,
the tap that finally moved the description would be the same tap that inserts.

Arrow keys are unchanged, and that is deliberate rather than an omission. The
palette publishes listbox semantics, where a screen reader announces "option 4
of 18" and Down means the next option; moving by a grid ROW instead would make
that announcement wrong by two every time. An honest grid keyboard needs a grid
accessibility tree — rows, cells and coordinates — and that is not something
the panel can add on top of the widget it composes. The grid is a layout, and
reading order runs left to right and then down, which is the order the arrow
keys already move in.

Each tile is now NAMED by its block and DESCRIBED by its sentence, rather than
announcing the two run together. A screen reader previously read a tile as
"TextA paragraph of plain text" — the name and the description concatenated
with no separator, and whether any separator appeared at all depended on the
stylesheet rather than the markup. The two are now stated separately, so the
block's name is read first and its description second.

The description reference is also safe for blocks nobody has written yet. A
variation's name is an unrestricted string and a variation is identified as
`block#variation`, so a variation named "wide card" used to put a SPACE in the
reference — which is a space-separated list of ids, so assistive technology
looked for two ids that did not exist and announced the tile with no
description at all.

The description strip now READS the palette's highlight rather than steering
it, and `@nextlyhq/ui` publishes `useCommandHighlight` so it can.

Steering it was wrong in a way that only assistive technology could see. The
palette's controlled value sets which tile is MARKED and does not move the
internal cursor that the announced option and the scroll position follow — so
the tile drawn as current and the option announced as current drifted apart,
and after a search removed the highlighted tile the announcement named an
element that was no longer in the document at all. A reference that resolves to
nothing is worse than none: a screen reader is told there is a current option
and then cannot find it.

Reading the palette's own state leaves one owner. It follows a pointer, an
arrow key and a filter alike, because those are the palette's business and it
was always doing them correctly.

Two smaller repairs to the same panel. A tile's identifier is now allocated
once and never reused, so a host replacing the block definitions while the
panel is open cannot have an identifier come to mean a different block — which
would have described one block and inserted another. And the description strip
returns to the top when it changes subject, instead of opening the next
description partway down where a previous one had been scrolled.
