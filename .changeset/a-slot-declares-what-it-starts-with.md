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

A Columns block now arrives with two columns instead of being empty.

Inserting Columns used to place a container with nothing in it, so an author
got an empty box and had to build both columns by hand before the block was
worth anything. An accordion had the same problem for the same reason: its
slot accepts only accordion sections, and a section cannot be placed anywhere
else, so an empty accordion offered no way forward. Both now arrive ready to
use — a row with two columns, an accordion with one section.

A block declares this for itself, so plugin containers can do the same. Each
slot may name the children it starts with:

    slots: {
      children: {
        defaultBlock: [{ type: "acme/cell" }, { type: "acme/cell" }],
      },
    }

Each entry is one child, and each carries its own props, so a row whose columns
have different widths is expressed by writing two different entries rather than
by repeating a count. The children are created fresh every time the block is
placed, so two rows on one page never share an id.

Card, Gallery, Box, Section and the accordion's own sections deliberately do
NOT declare a default: their slots accept any block, or accept one that is
placeable on its own, so there is no starting child that would be righter than
none.

BREAKING for block authors: `SlotSpec.template` is REMOVED. It held a list of
stored nodes carrying literal ids, so two containers expanded from one template
would have collided on `duplicate-node-id` — nothing in the codebase ever
expanded it, and no released behaviour depended on it. Replace a `template`
with a `defaultBlock` naming the child TYPES; ids are then minted per instance.
