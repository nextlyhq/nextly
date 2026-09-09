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

An author could browse the pattern library and never put anything in it. The
verb that stores a selection did not exist on any surface, so the Patterns tier
shipped with nothing to show and no way to add to it.

`Save as pattern` is now one of the block verbs, so it reaches the toolbar, the
right-click menu and the command palette the way every other verb does. It is
offered for a run of blocks as readily as for one, because a pattern is usually
several — a heading, a paragraph and a button — and it is disabled with a reason
whenever the planner would refuse the selection, asked of the planner rather
than restated, so the button and the save can never disagree.

The form asks for a name and for how much of a page the pattern covers — an
element, a group of blocks, or a whole section — with every option and its
meaning visible rather than behind a picker, because the choice is required and
has no default. It offers the granularities the insert panel can offer back,
which is why a whole-page pattern is not among them yet: that one is a way to
START a page, and the surface that would offer it does not exist. Category
suggestions come from what the library already uses, so one site does not grow
"Hero", "hero" and "Heroes" as three groupings nobody chose. Nobody is asked for
a slug.

A refused save keeps the form open with the draft intact. A name collision is
the expected failure and the remedy is to change a field that has to still be on
screen.
