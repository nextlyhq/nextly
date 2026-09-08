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

Rows in the tokens and classes panels named things without describing them.

A token row previewed only colours, so a shadow was an opaque string of
offsets, a size was a number with nothing to compare it against, and a weight
looked exactly like a number. Each kind that has a visual form is now drawn as
the thing it is: a shadow cast, a length measured, a weight and a family set in
themselves, and a duration shown by taking that long to cross its slot. A
number and a custom value are still shown as nothing, because neither has a
form to draw, and no value is previewed unless it can be resolved without the
site's token table — a reference resolved against the panel would show a colour
or a size the page does not have.

A class row named the class and counted the documents using it, and never said
what the class was for. It now lists the properties the class writes, compiled
by the engine rather than described a second time here, so what the row claims
and what the stylesheet carries cannot disagree. Because a class holds styles
for every state and breakpoint and a row can honestly show one, it shows the
base and says how many other places the class also sets something rather than
showing the base as though it were the whole story.
