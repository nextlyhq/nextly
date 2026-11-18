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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Every heading on a page now carries an id that is unique on the whole page, so
a link to a section lands on the right one. Heading blocks gain an id made from
their words (or their own CSS id when one is set), and headings inside Rich text
are numbered across the page rather than within one passage: two headings both
reading "Notes" are `#notes` and `#notes-2`, whichever blocks they sit in, and a
made id never takes an id an author gave any block. Headings in the Layout's
header and footer count too. This changes the HTML of every page with headings.

A Heading can be left out of a table of contents with "Leave out of table of
contents" in Advanced; it keeps its id. A selected Table of contents says where
that setting is.

The render context gains an `@experimental` `outline`: every heading the page
draws, in page order, with its words, level, block and anchor. `RichText` takes
the ids to draw its headings with as `anchors`, in place of `anchorHeadings`.
