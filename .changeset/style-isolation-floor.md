---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

Stylesheets compiled by `@nextlyhq/blocks-engine` now sit one specificity notch
higher, so ordinary site CSS no longer beats a value set in the builder by
accident. A rule like `.content .card h1` used to win over a block's own colour
and leave the author with a style that silently did not appear.

This applies to that engine's output. `@nextlyhq/plugin-page-builder` renders
through a compiler of its own that does not yet follow these weights, so pages
rendered through it are unchanged by this release.

Overriding on purpose still works: an unlayered selector that beats the builder's
specificity wins, and so does `!important`, because the compiler deliberately
never writes it. Two things are worth knowing.

If your CSS lives in a cascade layer, as Tailwind's does, layer order is settled
before specificity and the builder emits an unlayered stylesheet, so adding
classes inside an `@layer` will not win. Write the override unlayered, or use
`!important`.

If the property you are overriding is mid-transition, the transitioning value
outranks every author declaration including `!important` until the transition
ends. Add `transition: none !important` to your rule if that applies.
