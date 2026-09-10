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

Two slots of the chart palette were not legible in light mode. Measured against
the surface a widget draws on, the cyan and amber slots reached 2.21:1 and
2.15:1 — below the 3:1 minimum that applies to a graphical object someone has to
read to read the chart. The draft segment of the content lifecycle card is drawn
in the amber one.

Both move down their ramp in light mode only: cyan-600 and amber-700, measured
at 3.68:1 and 5.02:1. Dark mode is untouched, where the lighter steps sit at
9.0:1 and 9.3:1 against the same surface — the two modes need different steps of
one ramp rather than a single shared value, which is what they had.

The palette is now asserted rather than exempt. Every slot is held to the
minimum against the card surface, in both modes, so a slot that fails is caught
when the colour changes rather than when someone first draws a chart with it.
The bar fill a widget paints over its track is asserted the same way.
