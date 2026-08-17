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

feat(blocks-react): add core/card and core/form to the block library

Two blocks the derived block list marks as needed by every site inventoried,
including a client project.

`core/card` is a preset over the shared container implementation, differing
from a box only in what it starts as: rounded and clipping. The clip is the
substance rather than the rounding, because a border radius paints the box and
does not constrain its descendants, so a card that rounds without clipping
renders a child image's square corners over its own curve. It carries no
default padding, because padding on the card makes a full-bleed image
impossible; and no default background or border, because the guaranteed token
set has no surface or border colour and a hardcoded one is wrong in whichever
of light and dark it was not chosen for.

`core/form` renders plain HTML and ships no client JavaScript — the
form-builder plugin remains the one that stores submissions, and contributes no
block of its own, so the two do not compete. Its whole layout is one grid on
the root, so every label and control is a direct child rather than nested;
labels associate by `htmlFor` and an id derived from the node's id, so two
forms on one page cannot mint the same id and re-point one form's label at
another's field. The `action` is read through the same URL guard the other
blocks use, so a stored scheme that executes rather than navigates is refused.

`base-styles.test.tsx` is derived from `coreBlocks` rather than listing blocks
by hand: it asserts that every property a block declares in `baseStyles` is
known to `STYLE_CATALOG` and reaches the compiled stylesheet under that block's
own selector. Those are separate questions — a catalog property is still
dropped when its value does not match the grammar the catalog declares for it —
and the pair covers the failure that shipped in `core/columns`, whose first
version declared a flex item property the catalog does not carry and which the
compiler dropped silently while an object assertion stayed green.
