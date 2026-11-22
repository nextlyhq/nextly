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

Set the site's text once, for every page: Design → Type → "Site text" has one row each for Body, Heading 1 to Heading 6, Links, Buttons and Captions. Each row previews its look with its size and line height ("28 / 1.2"), and is pointed at a type size, which sets its size and line height together, or given a typed size (with the unit menu or "Fluid…") and line height, or left as "Your site's own". Links take a colour, a colour on hover and "Underline: Always / On hover / Never". A change restyles every matching element at once on the canvas and on published pages; a block, a block style, a shared style or a block's own value still wins over a row, and no row writes an outer margin.

- **Built-in type sizes.** The engine's built-in variables gain `font-size.h1`…`h6` and `font-size.small`, each with its `line-height.*` partner, in `rem`, equal to the heading sizes drawn before at a 16px root. The heading rows point at them; Body, Links, Buttons and Captions write nothing until set, so a host's own typography keeps working.
- **One element tier.** `SiteTokenSet.siteText` holds the rows (`@experimental`), and the engine's `siteTextElementBases()` turns them into the compiler's element tier: headings, `a`, `figcaption` (both new on the element tier's closed list), and Body on the page root under the new `root` key. `StyleCompileContext.siteText` carries the map to the block library, which derives the tier from it and lays Buttons over the Button block and the form's submit, and Captions over the Image caption. The renderer reconciles the map from the site's token set on every compile path: the canvas, the published route, a stored sheet and the style trace.
- **Removed export.** `TYPOGRAPHY_DEFAULTS` is gone from `@nextlyhq/blocks-react`: the block library holds no heading table of its own. Read `siteTextElementBases()` from `@nextlyhq/blocks-engine` instead; `withTypographyDefaults()` stays and now derives the tier from the context's `siteText`.
- **Heading sizes are `rem`.** A heading inside a container with its own text size no longer scales with it; set the size on the heading or on its Site text row.
- **Stored site style.** A record without site text reads as before, so nothing migrates. Older builds must not be run against a record that has site text. A row is validated on save, merged row by row with another author's save, and a type size a row uses is refused removal, naming the row.
- **In a block's Style tab**, picking a type size in Font size also sets the block's line height from it where the block has none of its own ("From H2 type size", with "Detach"); where it has its own, it is kept and "Use H2's line height" is offered. The field shows the type size as "H2 · 28 / 1.2". The style trace names a row's values "From Site text: Heading 2".
