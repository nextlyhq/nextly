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

A dashboard card that only matters sometimes had to hide itself. The
get-started card was placed in the grid, given an order, and then rendered
nothing once seeding was done or declined — so the arrangement reserved a slot
for a card drawing nothing, and the reason lived in a component rather than in
the declaration.

A widget can now declare that it is transient: the named condition it shows
under, whether it sits above the ordinary order while visible, and whether a
reader may end it early. The host evaluates the condition and stops offering
the card when it lapses.

The condition is a NAME from a closed set the host owns, never a predicate or
callback a widget supplies, so an onboarding surface cannot become the kind of
unconstrained notice channel that other admin ecosystems have never managed to
contain. A name this release cannot answer is refused when the widget is
registered, where the author can still be told.

The first condition asks whether THIS reader can see any content, and is
deliberately about the reader rather than the install: answering across
everything would report on rows the reader is not allowed to know exist. A
draft counts as content — someone who has written one post and not published it
is not looking at an empty install.
