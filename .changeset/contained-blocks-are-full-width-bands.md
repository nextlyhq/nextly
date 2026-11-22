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

A contained Section is now a full-width band. With **Constrain content width** on (a Section's default), its background reaches both edges of the page, and only its content is held to the site's content width, with at least `space.gutter` at each side. Before, the Section itself was narrowed and centred, so its background stopped short of the page edges. Box, Columns, Column, Card, Accordion and Gallery work the same way when the setting is on, on the canvas and on the published page, in normal flow, flex and grid alike. Side padding set on a contained block takes the gutter's place: a larger value moves the content further in, and 0 removes the gutter, but the content never runs wider than the content width. The canvas no longer labels a margin that comes from `auto` with a number.

The site sheet's content-width rule now pads a contained element's content in (`padding-inline: max(<gutter>, (100% - <content width>) / 2)`), carrying the inset in a registered, non-inherited custom property `--nx-contain-inset`, and every compiled inline padding is written as `max(<value>, var(--nx-contain-inset, 0px))`. It no longer sets `max-width`. A contained block an author gives its own width or maximum width is centred at that size with its content whole, as before: the rule that sets the size also flags it (`--nx-sized-width`, `--nx-sized-max-width`), and an override back to `auto` or `none` clears the flag. A content width given as an intrinsic size (`min-content`, `fit-content(…)` and the like) can't be inset to, so it no longer constrains contained blocks. A zero-valued length variable is written as `0px`, so it can take part in these expressions. A non-contained block's padding is unchanged. Because the compiled CSS changes, every stored page stylesheet is recompiled once, on its next read.
