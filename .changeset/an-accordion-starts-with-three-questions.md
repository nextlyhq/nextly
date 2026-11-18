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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

An Accordion starts with three questions, "Question 1" to "Question 3", each
holding one Text, "Write the answer here.". While the accordion or one of its
questions is selected, "+ Add a question" under the last question adds the
next numbered question, opens it on the canvas and puts the cursor in its
title. A question added from the Add panel, by a click or a drag, takes the
next number too. The accordion item is now called "Question" in the Add
panel, Layers and the block panel, and an open question emptied of its
answer draws the empty-container start.

The Accordion gains "Open: One at a time / Many" (One at a time for a new
one) and "First open" (on for a new one), and new accordions store Heading 3
titles. One at a time gives every question's `<details>` one shared name, so
the browser closes the others with no script. "Icon" moves to the Content tab
as "+ / −", "Chevron" and "None", "+ / −" by default; "Icon position" stays
in Style. A question's "Open by default" shows only while the accordion opens
Many.

Compatibility: an accordion stored without these settings reads as Many, with
no first question opened for it, so each question opens by its own setting as
before, and the block panel shows it that way. The stored shape is additive
and stays at version 1. The published HTML changes: each summary carries a
part class (a 44px minimum height and a focus ring in the text's colour), a
One at a time accordion's `<details>` carry a `name` attribute, and the
default icon is the plus, so a stored accordion that never set an icon, and
one storing "Browser default", now draws the plus where it drew a chevron or
the browser's marker; choosing "Chevron" in Content › Icon brings the chevron
back.
The stylesheet encoding moves to v13, since a stored "browser" icon now
compiles differently, so every stored sheet compiles again once.

New experimental surface: `PageContext.accordionGroup` in
`@nextlyhq/blocks-react`; a block prop's `whenUnset` (what an unset value reads
as) and `onlyWhenParent` (offered only while the parent holds a value), read by
the builder's block panel; and `AccordionAddQuestion` in
`@nextlyhq/builder/shell`.
